import { DeleteAttemptBtn } from '@/components/DeleteAttemptBtn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getAttemptReport } from '@/lib/actions/attempt.actions'
import Link from 'next/link'

const formatAnswer = (options: string[], selected: number[]) =>
	selected.length > 0
		? selected.map(n => options[n - 1]).join('; ')
		: 'нет ответа'

export default async function Result({ attemptId }: { attemptId: string }) {
	const report = await getAttemptReport(attemptId)

	const problemSubtopics = report.subtopics
		.filter(s => s.status === 'weak')
		.sort((a, b) => a.mastery - b.mastery)

	return (
		<main>
			<div className="flex justify-between items-center mb-10 max-sm:flex-col gap-5 max-sm:items-start">
				<div>
					<h2 className="text-2xl font-semibold tracking-tight sm:text-3xl mb-5">
						Попытка {report.attemptNumber}
					</h2>

					<p className="mb-2">
						Результат: верно {report.correctCount} из {report.total}
					</p>

					{report.attempt.completed_at && (
						<p>
							Дата завершения:{' '}
							{new Date(report.attempt.completed_at).toLocaleDateString(
								'ru-RU'
							)}
						</p>
					)}
				</div>
				{report.mistakes.length > 0 && (
					<Link href={`/attempt/${attemptId}/tutor`}>
						<Button>Работа над ошибками</Button>
					</Link>
				)}
			</div>

			<h3 className="text-xl font-semibold mb-5">Проблемные подтемы</h3>
			{problemSubtopics.length > 0 ? (
				<div className="flex flex-wrap gap-5 mb-10">
					{problemSubtopics.map(s => (
						<Badge
							key={s.subtopicId}
							variant={'outline'}
							className="rounded-full mb-5"
						>
							{s.title}
						</Badge>
					))}
				</div>
			) : (
				<p className="text-muted-foreground mb-10">
					Проблемных подтем не обнаружено
				</p>
			)}

			<h3 className="text-xl font-semibold mb-5">История ответов</h3>
			<div className="flex flex-col gap-5 mb-10">
				{report.history.map(item => (
					<div
						key={item.questionId}
						className={`rounded-xl p-6 border flex flex-col justify-between gap-5 ${
							item.isCorrect ? 'bg-emerald-50' : 'bg-destructive/3'
						}`}
					>
						<p className="font-semibold">
							{item.position}. {item.text}
						</p>
						<p>
							Правильный ответ: {formatAnswer(item.options, item.correctAnswer)}
						</p>
						{!item.isCorrect && (
							<p>Ваш ответ: {formatAnswer(item.options, item.userAnswer)}</p>
						)}
					</div>
				))}
			</div>

			<div className="flex justify-center">
				<DeleteAttemptBtn attemptId={attemptId} />
			</div>
		</main>
	)
}
