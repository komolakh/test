'use server'

import { questions, subtopics, type Question } from '@/lib/questions'
import { createSupabaseClient } from '@/lib/supabase'
import { auth, currentUser } from '@clerk/nextjs/server'

const ATTEMPT_LENGTH = 10
const EXPLORATION_COUNT = 6
const START_MASTERY = 0.5

type Supabase = ReturnType<typeof createSupabaseClient>

interface AnswerRow {
	id: string
	attempt_id: string
	question_id: number
	subtopic_id: number
	position: number
	user_answer: number[] | null
	is_correct: boolean | null
}

interface AttemptRow {
	id: string
	user_id: string
	attempt_number: number
	created_at: string
	completed_at: string | null
}

interface StatsHistoryRow {
	user_id: string
	attempt_id: string
	attempt_number: number
	subtopic_id: number
	mastery: number
	answered: number
	correct: number
	last_difficulty: number | null
	last_correct: boolean | null
	created_at: string
}

type AnsweredRow = AnswerRow & { is_correct: boolean }

interface AnsweredItem {
	questionId: number
	isCorrect: boolean
}

interface SubtopicStats {
	subtopicId: number
	mastery: number
	answered: number
	correct: number
	lastDifficulty: number | null
	lastCorrect: boolean | null
}

type SubtopicStatus = 'unknown' | 'weak' | 'medium' | 'strong'

const questionById = new Map(questions.map(q => [q.id, q]))
const subtopicTitleById = new Map(subtopics.map(s => [s.id, s.title]))

const getQuestion = (questionId: number) => questionById.get(questionId)

const correctSet = (q: Question): number[] =>
	Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]

const isCorrectAnswer = (q: Question, selected: number[]) => {
	const correct = new Set(correctSet(q))
	const chosen = new Set(selected)
	if (chosen.size !== correct.size) return false
	for (const n of chosen) if (!correct.has(n)) return false
	return true
}

const toPublicQuestion = (q: Question) => ({
	id: q.id,
	text: q.text,
	options: q.options,
	multiple: correctSet(q).length > 1,
	subtopic: subtopicTitleById.get(q.subtopicId) ?? ''
})

const onlyAnswered = (rows: AnswerRow[]) =>
	rows.filter((r): r is AnsweredRow => r.is_correct !== null)

const toAnsweredItem = (r: AnsweredRow): AnsweredItem => ({
	questionId: r.question_id,
	isCorrect: r.is_correct
})

const emptyStats = () =>
	new Map<number, SubtopicStats>(
		subtopics.map(s => [
			s.id,
			{
				subtopicId: s.id,
				mastery: START_MASTERY,
				answered: 0,
				correct: 0,
				lastDifficulty: null,
				lastCorrect: null
			}
		])
	)

const statsFromHistory = (rows: StatsHistoryRow[]) => {
	const stats = emptyStats()
	for (const r of rows) {
		const st = stats.get(r.subtopic_id)
		if (!st) continue
		st.mastery = r.mastery
		st.answered = r.answered
		st.correct = r.correct
		st.lastDifficulty = r.last_difficulty
		st.lastCorrect = r.last_correct
	}
	return stats
}

const applyAnswers = (
	stats: Map<number, SubtopicStats>,
	answered: AnsweredItem[]
) => {
	for (const a of answered) {
		const q = getQuestion(a.questionId)
		const st = q && stats.get(q.subtopicId)
		if (!q || !st) continue

		st.answered += 1
		if (a.isCorrect) st.correct += 1

		const d = q.difficulty

		let weight = a.isCorrect ? 0.5 + 0.5 * d : 1 - 0.5 * d

		if (q.options.length === 2) weight *= 0.7
		const rate = Math.max(0.25, 0.6 / st.answered)

		st.mastery += rate * weight * ((a.isCorrect ? 1 : 0) - st.mastery)
		st.lastDifficulty = d
		st.lastCorrect = a.isCorrect
	}
	return stats
}

const getStatus = (st: SubtopicStats): SubtopicStatus => {
	if (st.answered < 2) return 'unknown'
	if (st.mastery < 0.4) return 'weak'
	if (st.mastery >= 0.7) return 'strong'
	return 'medium'
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

const check = (error: { message: string } | null) => {
	if (error) throw new Error(error.message)
}

const unwrap = <T>(
	{ data, error }: { data: T | null; error: { message: string } | null },
	notFound: string
): T => {
	check(error)
	if (data === null) throw new Error(notFound)
	return data
}

const loadPreviousStats = async (
	supabase: Supabase,
	beforeAttemptNumber: number | null
) => {
	let lastQuery = supabase
		.from('subtopic_stats_history')
		.select('attempt_number')
		.order('attempt_number', { ascending: false })
		.limit(1)
	if (beforeAttemptNumber !== null)
		lastQuery = lastQuery.lt('attempt_number', beforeAttemptNumber)

	const last = unwrap<{ attempt_number: number }[]>(
		await lastQuery,
		'Failed to fetch stats history'
	)
	if (last.length === 0) return { stats: emptyStats(), hasHistory: false }

	const rows = unwrap<StatsHistoryRow[]>(
		await supabase
			.from('subtopic_stats_history')
			.select()
			.eq('attempt_number', last[0].attempt_number),
		'Failed to fetch stats history'
	)
	return { stats: statsFromHistory(rows), hasHistory: true }
}

const saveStatsSnapshot = async (
	supabase: Supabase,
	attempt: AttemptRow,
	rows: AnsweredRow[]
) => {
	const prev = await loadPreviousStats(supabase, attempt.attempt_number)
	const stats = applyAnswers(prev.stats, rows.map(toAnsweredItem))

	const payload = [...stats.values()].map(st => ({
		user_id: attempt.user_id,
		attempt_id: attempt.id,
		attempt_number: attempt.attempt_number,
		subtopic_id: st.subtopicId,
		mastery: st.mastery,
		answered: st.answered,
		correct: st.correct,
		last_difficulty: st.lastDifficulty,
		last_correct: st.lastCorrect
	}))

	const { error } = await supabase
		.from('subtopic_stats_history')
		.upsert(payload, { onConflict: 'attempt_id,subtopic_id' })
	check(error)
}

const pickNext = (
	stats: Map<number, SubtopicStats>,
	answeredInAttempt: number,
	hasHistory: boolean,
	excludedIds: Iterable<number>
): Question | null => {
	const excluded = new Set(excludedIds)
	const statsOf = (subtopicId: number) => stats.get(subtopicId)!

	const exploring = !hasHistory && answeredInAttempt < EXPLORATION_COUNT

	const candidates = subtopics.flatMap(({ id: subtopicId }) => {
		const list = questions.filter(q => q.subtopicId === subtopicId)
		const unseen = list.filter(q => !excluded.has(q.id))
		if (unseen.length === 0) return []
		return [{ subtopicId, unseen, seenRatio: 1 - unseen.length / list.length }]
	})
	if (candidates.length === 0) return null

	const untouched = candidates.filter(c => statsOf(c.subtopicId).answered === 0)
	const pool = exploring && untouched.length > 0 ? untouched : candidates

	const score = (c: (typeof candidates)[number]) => {
		const noise = Math.random() * 0.05
		if (exploring) return 1 - c.seenRatio + noise
		const st = statsOf(c.subtopicId)

		return 1 - st.mastery + 0.5 / (1 + st.answered) + noise
	}
	const best = pool
		.map(c => ({ c, s: score(c) }))
		.reduce((a, b) => (b.s > a.s ? b : a)).c

	const st = statsOf(best.subtopicId)
	let target = exploring ? 0.5 : st.mastery
	if (!exploring && st.lastDifficulty !== null) {
		target =
			st.lastCorrect === false
				? Math.min(st.mastery, st.lastDifficulty) - 0.2
				: Math.max(st.mastery, st.lastDifficulty) + 0.2
	}
	target = clamp01(target)

	return best.unseen.reduce((a, b) =>
		Math.abs(b.difficulty - target) < Math.abs(a.difficulty - target) ? b : a
	)
}

const getAttempt = async (supabase: Supabase, attemptId: string) =>
	unwrap<AttemptRow>(
		await supabase.from('attempts').select().eq('id', attemptId).maybeSingle(),
		'Attempt not found'
	)

const getAttemptAnswers = async (supabase: Supabase, attemptId: string) =>
	unwrap<AnswerRow[]>(
		await supabase
			.from('answers')
			.select()
			.eq('attempt_id', attemptId)
			.order('position', { ascending: true }),
		'Failed to fetch answers'
	)

const completeAttempt = async (supabase: Supabase, attempt: AttemptRow) => {
	const rows = onlyAnswered(await getAttemptAnswers(supabase, attempt.id))

	await saveStatsSnapshot(supabase, attempt, rows)

	const { error } = await supabase
		.from('attempts')
		.update({ completed_at: new Date().toISOString() })
		.eq('id', attempt.id)
		.is('completed_at', null)

	check(error)
}

const servedQuestion = (row: AnswerRow) => {
	const q = getQuestion(row.question_id)
	if (!q) throw new Error(`Question ${row.question_id} not found in bank`)
	return {
		done: false as const,
		question: toPublicQuestion(q),
		position: row.position,
		total: ATTEMPT_LENGTH
	}
}

export type NextQuestionResult =
	| ReturnType<typeof servedQuestion>
	| { done: true; reason: 'finished' | 'bank_exhausted' }

export const createAttempt = async () => {
	const { userId } = await auth()
	if (!userId) throw new Error('Unauthorized')

	return unwrap<AttemptRow>(
		await createSupabaseClient()
			.from('attempts')
			.insert({ user_id: userId })
			.select()
			.single(),
		'Failed to create an attempt'
	)
}

export const getAllAttempts = async () =>
	unwrap<AttemptRow[]>(
		await createSupabaseClient()
			.from('attempts')
			.select()
			.order('attempt_number', { ascending: false }),
		'Failed to fetch attempts'
	)

export const deleteAttempt = async (attemptId: string) => {
	const deleted = unwrap<unknown[]>(
		await createSupabaseClient()
			.from('attempts')
			.delete()
			.eq('id', attemptId)
			.select(),
		'Attempt not found'
	)
	if (deleted.length === 0) throw new Error('Attempt not found')
}

export const getNextQuestion = async (
	attemptId: string
): Promise<NextQuestionResult> => {
	const supabase = createSupabaseClient()

	const attempt = await getAttempt(supabase, attemptId)
	if (attempt.completed_at) return { done: true, reason: 'finished' }

	const rows = await getAttemptAnswers(supabase, attemptId)

	const pending = rows.find(r => r.user_answer === null)
	if (pending) return servedQuestion(pending)

	if (rows.length >= ATTEMPT_LENGTH) {
		await completeAttempt(supabase, attempt)
		return { done: true, reason: 'finished' }
	}

	// вопросы, которые пользователь уже видел (во всех попытках)
	const seen = unwrap<{ question_id: number }[]>(
		await supabase.from('answers').select('question_id'),
		'Failed to fetch history'
	)

	// метрики с прошлых попыток + ответы текущей
	const prev = await loadPreviousStats(supabase, attempt.attempt_number)
	const answeredNow = onlyAnswered(rows).map(toAnsweredItem)
	const stats = applyAnswers(prev.stats, answeredNow)

	const next = pickNext(
		stats,
		answeredNow.length,
		prev.hasHistory,
		seen.map(r => r.question_id)
	)

	if (!next) {
		await completeAttempt(supabase, attempt)
		return { done: true, reason: 'bank_exhausted' }
	}

	const { data: inserted, error } = await supabase
		.from('answers')
		.insert({
			attempt_id: attemptId,
			question_id: next.id,
			subtopic_id: next.subtopicId,
			position: rows.length + 1
		})
		.select()
		.single()

	if (error) {
		if (error.code === '23505') {
			const current = (await getAttemptAnswers(supabase, attemptId)).find(
				r => r.user_answer === null
			)
			if (current) return servedQuestion(current)
		}
		throw new Error(error.message)
	}

	return servedQuestion(inserted as AnswerRow)
}

export const submitAnswer = async (
	attemptId: string,
	questionId: number,
	selected: number[]
): Promise<{ finished: boolean }> => {
	const supabase = createSupabaseClient()

	const attempt = await getAttempt(supabase, attemptId)
	if (attempt.completed_at) throw new Error('Attempt is already completed')

	const question = getQuestion(questionId)
	if (!question) throw new Error('Question not found')

	const unique = [...new Set(selected)]
	const valid =
		unique.length > 0 &&
		unique.every(
			n => Number.isInteger(n) && n >= 1 && n <= question.options.length
		)
	if (!valid) throw new Error('Invalid answer')

	const updated = unwrap<AnswerRow[]>(
		await supabase
			.from('answers')
			.update({
				user_answer: unique,
				is_correct: isCorrectAnswer(question, unique),
				answered_at: new Date().toISOString()
			})
			.eq('attempt_id', attemptId)
			.eq('question_id', questionId)
			.is('user_answer', null)
			.select(),
		'Question was not served or is already answered'
	)
	if (updated.length === 0)
		throw new Error('Question was not served or is already answered')

	const finished = updated[0].position >= ATTEMPT_LENGTH
	if (finished) await completeAttempt(supabase, attempt)

	return { finished }
}

export const getAttemptReport = async (attemptId: string) => {
	const supabase = createSupabaseClient()

	const attempt = await getAttempt(supabase, attemptId)
	if (!attempt.completed_at) throw new Error('Attempt is not completed yet')

	const rows = onlyAnswered(await getAttemptAnswers(supabase, attemptId))

	const history = rows.map(r => {
		const q = getQuestion(r.question_id)!
		return {
			position: r.position,
			questionId: q.id,
			subtopicId: q.subtopicId,
			subtopic: subtopicTitleById.get(q.subtopicId) ?? '',
			difficulty: q.difficulty,
			text: q.text,
			options: q.options,
			userAnswer: r.user_answer ?? [],
			correctAnswer: correctSet(q),
			isCorrect: r.is_correct
		}
	})

	const snapshot = unwrap<StatsHistoryRow[]>(
		await supabase
			.from('subtopic_stats_history')
			.select()
			.eq('attempt_id', attemptId),
		'Failed to fetch stats history'
	)
	const stats =
		snapshot.length > 0
			? statsFromHistory(snapshot)
			: applyAnswers(
					(await loadPreviousStats(supabase, attempt.attempt_number)).stats,
					rows.map(toAnsweredItem)
			  )

	const subtopicsReport = subtopics.map(s => {
		const st = stats.get(s.id)!
		const inAttempt = history.filter(h => h.subtopicId === s.id)
		return {
			...st,
			title: s.title,
			status: getStatus(st),
			attemptAnswered: inAttempt.length,
			attemptCorrect: inAttempt.filter(h => h.isCorrect).length
		}
	})

	return {
		attempt,
		attemptNumber: attempt.attempt_number,
		total: rows.length,
		correctCount: history.filter(h => h.isCorrect).length,
		subtopics: subtopicsReport,
		history,
		mistakes: history.filter(h => !h.isCorrect)
	}
}

const difficultyLabel = (d: number) =>
	d < 0.34 ? 'лёгкий' : d < 0.67 ? 'средний' : 'сложный'

const statusLabel: Record<SubtopicStatus, string> = {
	weak: 'слабый уровень',
	medium: 'средний уровень',
	strong: 'хороший уровень',
	unknown: 'мало данных'
}

const formatChoice = (options: string[], selected: number[]) =>
	selected.length > 0
		? selected.map(n => `${n}. ${options[n - 1]}`).join(' | ')
		: 'нет ответа'

export const getTutorContext = async (attemptId: string) => {
	const report = await getAttemptReport(attemptId)
	const user = await currentUser()

	const mistakeBlocks = report.mistakes.map((m, i) => {
		const stats = report.subtopics.find(s => s.subtopicId === m.subtopicId)!
		const options = m.options.map((o, idx) => `  ${idx + 1}. ${o}`).join('\n')

		return [
			`ОШИБКА ${i + 1} ИЗ ${report.mistakes.length} (вопрос номер ${
				m.position
			} в тесте)`,
			`Подтема: ${m.subtopic}`,
			`Сложность вопроса внутри подтемы: ${difficultyLabel(m.difficulty)}`,
			`Формат: ${
				m.correctAnswer.length > 1
					? 'несколько правильных ответов'
					: 'один правильный ответ'
			}`,
			`Вопрос: ${m.text}`,
			`Варианты:\n${options}`,
			`Студент выбрал: ${formatChoice(m.options, m.userAnswer)}`,
			`Правильно: ${formatChoice(m.options, m.correctAnswer)}`,
			`Итог по этой подтеме в попытке: верно ${stats.attemptCorrect} из ${
				stats.attemptAnswered
			}; общий уровень по подтеме за все попытки: ${
				statusLabel[stats.status]
			} (верно ${stats.correct} из ${stats.answered})`
		].join('\n')
	})

	const correctBlocks = report.history
		.filter(h => h.isCorrect)
		.map(h => `- ${h.subtopic} (${difficultyLabel(h.difficulty)}): ${h.text}`)

	return {
		attemptNumber: report.attemptNumber,
		userName: user?.firstName?.trim() || 'студент',
		userImage: user?.imageUrl ?? null,
		mistakesCount: String(report.mistakes.length),
		attemptSummary: `верно ${report.correctCount} из ${report.total}`,
		answersContext: [
			mistakeBlocks.join('\n\n'),
			'ВОПРОСЫ, НА КОТОРЫЕ СТУДЕНТ ОТВЕТИЛ ВЕРНО (помогают отличить пробел в знаниях от невнимательности):',
			correctBlocks.length > 0 ? correctBlocks.join('\n') : 'таких нет'
		].join('\n\n')
	}
}
