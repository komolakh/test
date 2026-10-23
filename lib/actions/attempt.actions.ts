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
	created_at: string
	completed_at: string | null
}

type AnsweredRow = AnswerRow & { is_correct: boolean }

interface AnsweredItem {
	questionId: number
	isCorrect: boolean
}

interface SubtopicStats {
	subtopicId: number
	mastery: number // 0..1
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

const computeStats = (answered: AnsweredItem[]) => {
	const stats = new Map<number, SubtopicStats>(
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

	for (const a of answered) {
		const q = getQuestion(a.questionId)
		const st = q && stats.get(q.subtopicId)
		if (!q || !st) continue

		st.answered += 1
		if (a.isCorrect) st.correct += 1

		const d = q.difficulty
		// верный ответ на сложный вопрос и ошибка на лёгком весят больше
		let weight = a.isCorrect ? 0.5 + 0.5 * d : 1 - 0.5 * d
		// в вопросе с двумя вариантами ответ легко угадать
		if (q.options.length === 2) weight *= 0.7
		const rate = Math.max(0.25, 0.6 / st.answered)

		st.mastery += rate * weight * ((a.isCorrect ? 1 : 0) - st.mastery)
		st.lastDifficulty = d
		st.lastCorrect = a.isCorrect
	}
	return stats
}

const getStatus = (st: SubtopicStats): SubtopicStatus => {
	if (st.answered < 2) return 'unknown' // мало данных
	if (st.mastery < 0.4) return 'weak'
	if (st.mastery >= 0.7) return 'strong'
	return 'medium'
}

const buildSubtopicReport = (answered: AnsweredItem[]) => {
	const stats = computeStats(answered)
	return subtopics.map(s => {
		const st = stats.get(s.id)!
		return { ...st, title: s.title, status: getStatus(st) }
	})
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

const pickNext = (
	answered: AnsweredItem[],
	excludedIds: Iterable<number>
): Question | null => {
	const excluded = new Set(excludedIds)
	for (const a of answered) excluded.add(a.questionId)

	const stats = computeStats(answered)
	const statsOf = (subtopicId: number) => stats.get(subtopicId)!
	const exploring = answered.length < EXPLORATION_COUNT

	const candidates = subtopics.flatMap(({ id: subtopicId }) => {
		const list = questions.filter(q => q.subtopicId === subtopicId)
		const unseen = list.filter(q => !excluded.has(q.id))
		if (unseen.length === 0) return []
		return [{ subtopicId, unseen, seenRatio: 1 - unseen.length / list.length }]
	})
	if (candidates.length === 0) return null

	// Подтема: сначала те, где ещё не было ответов
	const untouched = candidates.filter(c => statsOf(c.subtopicId).answered === 0)
	const pool = exploring && untouched.length > 0 ? untouched : candidates

	const score = (c: (typeof candidates)[number]) => {
		const noise = Math.random() * 0.05
		if (exploring) return 1 - c.seenRatio + noise
		const st = statsOf(c.subtopicId)
		// слабые подтемы и подтемы с малым числом ответов
		return 1 - st.mastery + 0.5 / (1 + st.answered) + noise
	}
	const best = pool
		.map(c => ({ c, s: score(c) }))
		.reduce((a, b) => (b.s > a.s ? b : a)).c

	// Вопрос: ближайший к целевой сложности
	const st = statsOf(best.subtopicId)
	let target = exploring ? 0.5 : st.mastery
	if (!exploring && st.lastDifficulty !== null) {
		target =
			st.lastCorrect === false
				? Math.min(st.mastery, st.lastDifficulty) - 0.2 // спускаемся ниже
				: Math.max(st.mastery, st.lastDifficulty) + 0.2 // поднимаемся выше
	}
	target = clamp01(target)

	return best.unseen.reduce((a, b) =>
		Math.abs(b.difficulty - target) < Math.abs(a.difficulty - target) ? b : a
	)
}

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

const completeAttempt = async (supabase: Supabase, attemptId: string) => {
	const { error } = await supabase
		.from('attempts')
		.update({ completed_at: new Date().toISOString() })
		.eq('id', attemptId)
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
			.order('created_at', { ascending: false }),
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
		await completeAttempt(supabase, attemptId)
		return { done: true, reason: 'finished' }
	}

	const seen = unwrap<{ question_id: number }[]>(
		await supabase.from('answers').select('question_id'),
		'Failed to fetch history'
	)

	const next = pickNext(
		onlyAnswered(rows).map(toAnsweredItem),
		seen.map(r => r.question_id)
	)

	if (!next) {
		await completeAttempt(supabase, attemptId)
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
	if (finished) await completeAttempt(supabase, attemptId)

	return { finished }
}

export const getAttemptReport = async (attemptId: string) => {
	const supabase = createSupabaseClient()

	const attempt = await getAttempt(supabase, attemptId)
	if (!attempt.completed_at) throw new Error('Attempt is not completed yet')

	const { count, error } = await supabase
		.from('attempts')
		.select('id', { count: 'exact', head: true })
		.lte('created_at', attempt.created_at)
	check(error)

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

	return {
		attempt,
		attemptNumber: count ?? 1,
		total: rows.length,
		correctCount: history.filter(h => h.isCorrect).length,
		subtopics: buildSubtopicReport(rows.map(toAnsweredItem)),
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
			`Итог по этой подтеме в попытке: верно ${stats.correct} из ${
				stats.answered
			} (${statusLabel[stats.status]})`
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
