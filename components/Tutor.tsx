'use client'

import soundwaves from '@/constants/soundwaves.json'
import { cn, configureAssistant } from '@/lib/utils'
import { vapi } from '@/lib/vapi.sdk'
import type { AnimationItem } from 'lottie-web'
import { Mic, MicOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'

type CallStatus = 'INACTIVE' | 'CONNECTING' | 'ACTIVE' | 'FINISHED'

interface SavedMessage {
	role: 'assistant' | 'user' | 'system'
	content: string
}

const pluralizeMistakes = (count: number) => {
	const n = Math.abs(count) % 100
	const last = n % 10
	if (n > 10 && n < 20) return 'ошибок'
	if (last === 1) return 'ошибка'
	if (last >= 2 && last <= 4) return 'ошибки'
	return 'ошибок'
}

interface TutorProps {
	attemptNumber: number
	userName: string
	userImage: string | null
	mistakesCount: string
	attemptSummary: string
	answersContext: string
}

const TutorComponent = ({
	attemptNumber,
	userName,
	mistakesCount,
	attemptSummary,
	answersContext
}: TutorProps) => {
	const [callStatus, setCallStatus] = useState<CallStatus>('INACTIVE')
	const [isSpeaking, setIsSpeaking] = useState(false)
	const [isMuted, setIsMuted] = useState(false)
	const [messages, setMessages] = useState<SavedMessage[]>([])
	const [error, setError] = useState<string | null>(null)

	const waveContainerRef = useRef<HTMLDivElement>(null)
	const waveAnimationRef = useRef<AnimationItem | null>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)

	const isActive = callStatus === 'ACTIVE'
	const isConnecting = callStatus === 'CONNECTING'

	useEffect(() => {
		let cancelled = false

		import('lottie-web').then(({ default: lottie }) => {
			if (cancelled || !waveContainerRef.current) return
			waveAnimationRef.current = lottie.loadAnimation({
				container: waveContainerRef.current,
				renderer: 'svg',
				loop: true,
				autoplay: false,
				animationData: soundwaves
			})
		})

		return () => {
			cancelled = true
			waveAnimationRef.current?.destroy()
			waveAnimationRef.current = null
		}
	}, [])

	useEffect(() => {
		if (isSpeaking) waveAnimationRef.current?.play()
		else waveAnimationRef.current?.stop()
	}, [isSpeaking])

	useEffect(() => {
		const onCallStart = () => setCallStatus('ACTIVE')

		const onCallEnd = () => {
			setCallStatus('FINISHED')
			setIsSpeaking(false)
			setIsMuted(false)
		}

		const onMessage = (message: {
			type: string
			role?: SavedMessage['role']
			transcriptType?: string
			transcript?: string
		}) => {
			if (
				message.type === 'transcript' &&
				message.transcriptType === 'final' &&
				message.role &&
				message.transcript
			) {
				const newMessage: SavedMessage = {
					role: message.role,
					content: message.transcript
				}
				setMessages(prev => [...prev, newMessage])
			}
		}

		const onError = (e: unknown) => {
			console.error('Vapi error', e)
			setError(
				'Проблема с соединением. Проверьте микрофон и попробуйте ещё раз.'
			)
			setCallStatus(prev => (prev === 'CONNECTING' ? 'INACTIVE' : prev))
		}

		const onSpeechStart = () => setIsSpeaking(true)
		const onSpeechEnd = () => setIsSpeaking(false)

		vapi.on('call-start', onCallStart)
		vapi.on('call-end', onCallEnd)
		vapi.on('message', onMessage)
		vapi.on('error', onError)
		vapi.on('speech-start', onSpeechStart)
		vapi.on('speech-end', onSpeechEnd)

		return () => {
			vapi.off('call-start', onCallStart)
			vapi.off('call-end', onCallEnd)
			vapi.off('message', onMessage)
			vapi.off('error', onError)
			vapi.off('speech-start', onSpeechStart)
			vapi.off('speech-end', onSpeechEnd)
		}
	}, [])

	useEffect(() => {
		return () => {
			vapi.stop()
		}
	}, [])

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	const toggleMicrophone = () => {
		const muted = vapi.isMuted()
		vapi.setMuted(!muted)
		setIsMuted(!muted)
	}

	const handleCall = async () => {
		setError(null)
		setMessages([])
		setIsMuted(false)
		setCallStatus('CONNECTING')

		try {
			await vapi.start(configureAssistant(), {
				variableValues: {
					user_name: userName,
					mistakes_count: mistakesCount,
					attempt_summary: attemptSummary,
					answers_context: answersContext
				}
			})
		} catch (e) {
			console.error('Vapi start error', e)
			setError('Не удалось начать. Попробуйте ещё раз.')
			setCallStatus('INACTIVE')
		}
	}

	const handleDisconnect = () => {
		vapi.stop()
		setCallStatus('FINISHED')
		setIsSpeaking(false)
		setIsMuted(false)
	}

	return (
		<main>
			<div className="flex justify-between items-center mb-20 max-sm:flex-col gap-5 max-sm:items-start">
				<div>
					<h2 className="text-2xl font-semibold tracking-tight sm:text-3xl mb-5">
						Работа над ошибками
					</h2>
					<p>
						Попытка {attemptNumber}: {mistakesCount}{' '}
						{pluralizeMistakes(Number(mistakesCount))}
					</p>
				</div>

				<div className="flex gap-5 ">
					<Button
						onClick={toggleMicrophone}
						variant={'outline'}
						disabled={!isActive}
					>
						{isMuted ? (
							<MicOff style={{ height: '28px', width: '28px' }} />
						) : (
							<Mic style={{ height: '28px', width: '28px' }} />
						)}
					</Button>

					<Button
						variant={
							isActive ? 'destructive' : isConnecting ? 'outline' : 'default'
						}
						onClick={isActive ? handleDisconnect : handleCall}
						disabled={isConnecting}
					>
						{isActive
							? 'Завершить'
							: isConnecting
							? 'Подключение...'
							: callStatus === 'FINISHED'
							? 'Начать заново'
							: 'Начать'}
					</Button>
				</div>
			</div>

			<div className="flex justify-center items-center mb-15">
				<div className={cn('absolute transition-opacity duration-500')}>
					<div
						ref={waveContainerRef}
						className="h-[200px]"
					/>
				</div>

				{error && <p className=" text-red-600 text-center">{error}</p>}
			</div>

			<section className="relative flex flex-col gap-5 w-full h-100 grow overflow-hidden">
				<div className="h-full overflow-y-auto flex flex-col gap-5 scrollbar-thumb-white">
					{messages
						.filter(m => m.role !== 'system')
						.map((message, index) =>
							message.role === 'assistant' ? (
								<div
									key={index}
									className="flex justify-start"
								>
									<div className="bg-muted rounded-full rounded-tl-none px-4 py-2 max-w-[80%]">
										<p>{message.content}</p>
									</div>
								</div>
							) : (
								<div
									key={index}
									className="flex gap-3 justify-end"
								>
									<div className="bg-primary rounded-full rounded-tr-none px-4 py-2 max-w-[80%]">
										<p className="text-white">{message.content}</p>
									</div>
								</div>
							)
						)}
					<div ref={messagesEndRef} />
				</div>
			</section>
		</main>
	)
}

export default TutorComponent
