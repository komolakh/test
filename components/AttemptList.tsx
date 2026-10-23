'use client'

import { createAttempt } from '@/lib/actions/attempt.actions'
import { redirect } from 'next/navigation'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

export interface Attempt {
	id: string
	user_id?: string | null
	created_at: string
	completed_at?: string | null
}

export interface AttemptsProps {
	attempts: Attempt[]
}

const AttemptList = ({ attempts }: AttemptsProps) => {
	const handleCreateAttempt = async () => {
		const attempt = await createAttempt()

		if (attempt) {
			redirect(`/attempt/${attempt.id}/question`)
		} else {
			console.log('Failed to create an attempt')
			redirect('/')
		}
	}

	return (
		<main>
			<h1>Теория вероятностей и математическая статистика</h1>
			<Button onClick={() => handleCreateAttempt()}>Новая попытка</Button>

			<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-10">
				{attempts.map((attempt: Attempt, index: number) => (
					<div
						key={attempt.id}
						className="rounded-xl p-6 border flex flex-col justify-between gap-5"
					>
						<div className="flex justify-between items-center">
							<h3 className="text-xl font-semibold">
								Попытка {attempts.length - index}
							</h3>
							<Badge variant={attempt.completed_at ? 'success' : 'destructive'}>
								{attempt.completed_at ? 'Завершена' : 'Не завершена'}
							</Badge>
						</div>

						<p>
							Дата создания:{' '}
							{new Date(attempt.created_at).toLocaleDateString('ru-RU')}
						</p>

						<Button
							onClick={() =>
								attempt.completed_at
									? redirect(`/attempt/${attempt.id}`)
									: redirect(`/attempt/${attempt.id}/question`)
							}
							variant={'outline'}
							className="w-full"
						>
							Подробнее
						</Button>
					</div>
				))}
			</div>
		</main>
	)
}

export default AttemptList
