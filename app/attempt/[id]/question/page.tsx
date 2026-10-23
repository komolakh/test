import Questions from '@/components/Questions'
import { Suspense } from 'react'

interface QuestionPageProps {
	params: Promise<{ id: string }>
}

export default function QuestionPage({ params }: QuestionPageProps) {
	return (
		<Suspense fallback={<div className="p-5 text-center">Загрузка...</div>}>
			<QuestionServer params={params} />
		</Suspense>
	)
}

const QuestionServer = async ({ params }: QuestionPageProps) => {
	const { id } = await params
	return <Questions attemptId={id} />
}
