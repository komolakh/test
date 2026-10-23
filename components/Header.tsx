import { Button } from '@/components/ui/button'
import { Show, SignInButton, UserButton } from '@clerk/nextjs'
import Link from 'next/link'

const Header = () => {
	return (
		<nav className="flex items-center justify-between px-14 py-4 max-sm:px-4">
			<Link
				href="/"
				className="font-bold text-3xl"
			>
				Тест
			</Link>
			<Show when="signed-out">
				<SignInButton>
					<Button>Войти</Button>
				</SignInButton>
			</Show>
			<Show when="signed-in">
				<UserButton
					appearance={{
						elements: {
							avatarBox: { width: 36, height: 36 }
						}
					}}
				/>
			</Show>
		</nav>
	)
}

export default Header
