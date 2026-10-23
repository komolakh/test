'use client'

import { deleteAttempt } from '@/lib/actions/attempt.actions'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from './ui/button'

interface DeleteAttemptButtonProps {
	attemptId: string
	redirectTo?: string
}

export const DeleteAttemptBtn = ({
	attemptId,
	redirectTo = '/'
}: DeleteAttemptButtonProps) => {
	const router = useRouter()
	const [pending, setPending] = useState(false)

	const handleClick = async () => {
		if (!window.confirm('Удалить попытку? Это действие нельзя отменить.'))
			return

		setPending(true)
		try {
			await deleteAttempt(attemptId)
			router.push(redirectTo)
			router.refresh()
		} catch (e) {
			window.alert(
				e instanceof Error ? e.message : 'Не удалось удалить попытку'
			)
			setPending(false)
		}
	}

	return (
		<Button
			variant={'destructive'}
			onClick={handleClick}
			disabled={pending}
		>
			{pending ? 'Удаление...' : 'Удалить попытку'}
		</Button>
	)
}
