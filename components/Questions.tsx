'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	getNextQuestion,
	submitAnswer,
	type NextQuestionResult
} from '@/lib/actions/attempt.actions'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Progress } from './ui/progress'

type ActiveQuestion = Extract<NextQuestionResult, { done: false }>

interface QuestionsProps {
	attemptId: string
}

const getErrorMessage = (e: unknown) =>
	e instanceof Error ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.'

export default function Questions({ attemptId }: QuestionsProps) {
	const router = useRouter()
	const [current, setCurrent] = useState<ActiveQuestion | null>(null)
	const [selected, setSelected] = useState<number[]>([])
	const [loading, setLoading] = useState(true)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const resultUrl = `/attempt/${attemptId}`

	useEffect(() => {
		let cancelled = false

		getNextQuestion(attemptId)
			.then(res => {
				if (cancelled) return
				if (res.done) {
					router.replace(resultUrl)
					return
				}
				setCurrent(res)
				setLoading(false)
			})
			.catch(e => {
				if (cancelled) return
				setError(getErrorMessage(e))
				setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [attemptId, resultUrl, router])

	const handleSelectOption = (optionNumber: number) => {
		if (!current) return

		if (current.question.multiple) {
			setSelected(prev =>
				prev.includes(optionNumber)
					? prev.filter(n => n !== optionNumber)
					: [...prev, optionNumber]
			)
		} else {
			setSelected([optionNumber])
		}
	}

	const handleNextQuestion = async () => {
		if (!current || selected.length === 0) return

		setSubmitting(true)
		setError(null)
		let navigating = false

		try {
			const { finished } = await submitAnswer(
				attemptId,
				current.question.id,
				selected
			)

			if (finished) {
				navigating = true
				router.push(resultUrl)
				return
			}

			const next = await getNextQuestion(attemptId)
			if (next.done) {
				navigating = true
				router.push(resultUrl)
				return
			}

			setCurrent(next)
			setSelected([])
		} catch (e) {
			setError(getErrorMessage(e))
		} finally {
			if (!navigating) setSubmitting(false)
		}
	}

	if (loading) {
		return <div className="p-5 text-center">Загрузка вопроса...</div>
	}

	if (!current) {
		return (
			<main>
				<div className="p-5 text-center">
					{' '}
					{error ?? 'Не удалось загрузить вопрос'}
				</div>
				<Button onClick={() => router.refresh()}>Повторить</Button>
			</main>
		)
	}

	const { question, position, total } = current
	const progressPercentage = (position / total) * 100

	return (
		<main>
			<p className="mb-2">
				Вопрос {position} из {total}
			</p>

			<Progress
				value={progressPercentage}
				className="mb-10"
			/>

			<Badge
				variant={'outline'}
				className="px-5 py-2 rounded-full text-md font-bold mb-5"
			>
				{question.subtopic}
			</Badge>

			<h2 className="text-xl font-semibold sm:text-2xl mb-5">
				{question.text}
			</h2>

			{question.multiple && (
				<p className="text-muted-foreground mb-5">
					Выберите все правильные варианты
				</p>
			)}

			<div className="space-y-5 mb-10">
				{question.options.map((option, index) => {
					const optionNumber = index + 1
					const isSelected = selected.includes(optionNumber)

					return (
						<button
							key={optionNumber}
							type="button"
							aria-pressed={isSelected}
							disabled={submitting}
							onClick={() => handleSelectOption(optionNumber)}
							className={`w-full p-4 rounded-xl border transition-all duration-200 text-left ${
								isSelected
									? 'border-primary bg-muted text-primary ring-2 ring-primary/20'
									: ''
							}`}
						>
							{option}
						</button>
					)
				})}
			</div>

			{error && <p className="text-destructive text-center mb-5">{error}</p>}

			<div className="flex justify-center">
				<Button
					onClick={handleNextQuestion}
					disabled={selected.length === 0 || submitting}
				>
					{submitting
						? 'Сохранение...'
						: position === total
						? 'Завершить'
						: 'Далее'}
				</Button>
			</div>
		</main>
	)
}
