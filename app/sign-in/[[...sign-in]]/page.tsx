import { SignIn } from '@clerk/nextjs'
import { Suspense } from 'react'

export default function SignInPage() {
	return (
		<main className="flex items-center justify-center mt-14">
			<Suspense fallback={null}>
				<SignIn />
			</Suspense>
		</main>
	)
}
