/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import pinia from '../../stores/pinia.ts'
import { useTokenStore } from '../../stores/token.ts'
import { signalingJoinConversation, signalingLeaveConversation } from './index.js'

const CALL_ROOM = 'callroom1'
const OTHER_ROOM = 'other0002'

const { signalingMock } = vi.hoisted(() => ({
	signalingMock: {
		joinRoom: vi.fn(() => Promise.resolve()),
		leaveRoom: vi.fn(() => Promise.resolve()),
		on: vi.fn(),
		hasFeature: vi.fn(() => false),
		disconnect: vi.fn(),
		setSettings: vi.fn(),
		settings: {},
	},
}))

vi.mock('../signaling.js', () => ({
	default: { createConnection: vi.fn(() => signalingMock) },
}))

vi.mock('../../services/signalingService.js', () => ({
	fetchSignalingSettings: vi.fn(() => Promise.resolve({
		data: { ocs: { data: { signalingMode: 'external' } } },
	})),
}))

describe('signaling room guard', () => {
	const tokenStore = useTokenStore(pinia)

	beforeEach(() => {
		vi.clearAllMocks()
		tokenStore.activeCallToken = ''
	})

	test('joins a conversation when no call is ongoing', async () => {
		await signalingJoinConversation(CALL_ROOM, 'session-id')

		expect(signalingMock.joinRoom).toHaveBeenCalledWith(CALL_ROOM, 'session-id')
	})

	test('refuses to move the signaling session out of an ongoing call', async () => {
		tokenStore.activeCallToken = CALL_ROOM

		// This is what the 404 recovery in useActiveSession does when a request
		// for the browsed conversation is answered with "no session here".
		await signalingJoinConversation(OTHER_ROOM, 'session-id')

		expect(signalingMock.joinRoom).not.toHaveBeenCalled()
	})

	test('still joins the conversation the call is in', async () => {
		tokenStore.activeCallToken = CALL_ROOM

		await signalingJoinConversation(CALL_ROOM, 'session-id')

		expect(signalingMock.joinRoom).toHaveBeenCalledWith(CALL_ROOM, 'session-id')
	})

	test('refuses to leave the conversation holding an ongoing call', async () => {
		tokenStore.activeCallToken = CALL_ROOM

		await signalingLeaveConversation(CALL_ROOM)

		expect(signalingMock.leaveRoom).not.toHaveBeenCalled()
	})

	test('leaves the conversation once its call has been left', async () => {
		await signalingJoinConversation(CALL_ROOM, 'session-id')
		tokenStore.activeCallToken = ''

		await signalingLeaveConversation(CALL_ROOM)

		expect(signalingMock.leaveRoom).toHaveBeenCalledWith(CALL_ROOM)
	})
})
