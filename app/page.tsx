import AttemptList from '@/components/AttemptList'
import { getAllAttempts } from '@/lib/actions/attempt.actions'
import { Suspense } from 'react'

export default async function HomePage() {
	return (
		<Suspense fallback={<div className="p-5 text-center">Загрузка...</div>}>
			<AttemptListServer />
		</Suspense>
	)
}

async function AttemptListServer() {
	const attempts = await getAllAttempts()

	return <AttemptList attempts={attempts} />
}
