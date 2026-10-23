import Header from '@/components/Header'
import { ClerkProvider } from '@clerk/nextjs'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin']
})

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin']
})

export const metadata: Metadata = {
	title: 'Тест',
	description: 'Тест'
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
	return (
		<html lang="en">
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen font-sans`}
			>
				<ClerkProvider appearance={{ variables: { colorPrimary: '#448aff' } }}>
					<Suspense fallback={null}>
						<Header />
					</Suspense>
					{children}
				</ClerkProvider>
			</body>
		</html>
	)
}
