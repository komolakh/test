import TutorComponent from '@/components/Tutor'
import { getTutorContext } from '@/lib/actions/attempt.actions'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

interface TutorPageProps {
	params: Promise<{ id: string }>
}

const TutorPage = ({ params }: TutorPageProps) => (
	<Suspense fallback={<div className="p-5 text-center">Загрузка...</div>}>
		<TutorServer params={params} />
	</Suspense>
)

const TutorServer = async ({ params }: TutorPageProps) => {
	const { id } = await params

	const context = await getTutorContext(id).catch(() => null)
	if (!context) notFound()

	return <TutorComponent {...context} />
}

export default TutorPage
