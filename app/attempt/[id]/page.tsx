import Result from '@/components/Result'
import { Suspense } from 'react'

export default function Page({ params }: { params: Promise<{ id: string }> }) {
	return (
		<Suspense fallback={<div className="p-5 text-center">Загрузка...</div>}>
			<ResultServer params={params} />
		</Suspense>
	)
}

async function ResultServer({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	return <Result attemptId={id} />
}
