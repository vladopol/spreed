/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getBrowseSessionToken } from '../../services/talkSessionUniqueTabId.ts'
import Signaling from '../signaling.js'
import {
	destroyBrowseSignaling,
	getBrowseSignalingToken,
	mountBrowseSignaling,
	unmountBrowseSignaling,
} from './browseSignaling.js'

vi.mock('@nextcloud/axios', () => ({
	default: {
		post: vi.fn(() => Promise.resolve({ data: { ocs: { data: { sessionId: 'session-id' } } } })),
		delete: vi.fn(() => Promise.resolve()),
	},
}))

vi.mock('../../services/signalingService.js', () => ({
	fetchSignalingSettings: vi.fn(() => Promise.resolve({
		data: { ocs: { data: { signalingMode: 'external' } } },
	})),
}))

vi.mock('../../services/CapabilitiesManager.ts', () => ({
	getTalkConfig: vi.fn(() => 0),
}))

vi.mock('../../store/index.js', () => ({
	default: { dispatch: vi.fn() },
}))

vi.mock('../SignalingTypingHandler.js', () => ({
	default: class SignalingTypingHandlerStub {
		setSignaling = vi.fn()
		destroy = vi.fn()
	},
}))

vi.mock('../signaling.js', () => ({
	default: { createConnection: vi.fn() },
}))

const CALL_ROOM = 'callroom1'
const ROOM_B = 'roomb0002'
const ROOM_C = 'roomc0003'

/**
 * Build a stub of a signaling connection.
 */
function createConnectionStub() {
	return {
		joinRoom: vi.fn(),
		leaveRoom: vi.fn(() => Promise.resolve()),
		disconnect: vi.fn(),
		on: vi.fn(),
		setEventBusEmitAllowlist: vi.fn(),
	}
}

describe('browseSignaling', () => {
	beforeEach(async () => {
		vi.clearAllMocks()
		Signaling.createConnection.mockImplementation(createConnectionStub)
		await destroyBrowseSignaling()
		vi.clearAllMocks()
	})

	test('opens one connection and reuses it when switching browsed conversations', async () => {
		expect(await mountBrowseSignaling(ROOM_B)).toBe(true)
		expect(Signaling.createConnection).toHaveBeenCalledTimes(1)
		const connection = Signaling.createConnection.mock.results[0].value
		expect(connection.joinRoom).toHaveBeenCalledWith(ROOM_B, 'session-id')

		expect(await mountBrowseSignaling(ROOM_C)).toBe(true)

		// Same connection: the room is switched on it, not a new one opened.
		expect(Signaling.createConnection).toHaveBeenCalledTimes(1)
		expect(connection.leaveRoom).toHaveBeenCalledWith(ROOM_B)
		expect(connection.joinRoom).toHaveBeenCalledWith(ROOM_C, 'session-id')
		expect(connection.disconnect).not.toHaveBeenCalled()
		expect(getBrowseSignalingToken()).toBe(ROOM_C)
	})

	test('keeps the connection when returning to the call, and reuses it for the next browse', async () => {
		await mountBrowseSignaling(ROOM_B)
		const connection = Signaling.createConnection.mock.results[0].value

		await unmountBrowseSignaling()

		expect(connection.leaveRoom).toHaveBeenCalledWith(ROOM_B)
		expect(connection.disconnect).not.toHaveBeenCalled()
		expect(getBrowseSignalingToken()).toBeNull()

		await mountBrowseSignaling(ROOM_C)

		expect(Signaling.createConnection).toHaveBeenCalledTimes(1)
		expect(connection.joinRoom).toHaveBeenCalledWith(ROOM_C, 'session-id')
	})

	test('disconnects only when the session is destroyed', async () => {
		await mountBrowseSignaling(ROOM_B)
		const connection = Signaling.createConnection.mock.results[0].value

		await destroyBrowseSignaling()

		expect(connection.leaveRoom).toHaveBeenCalledWith(ROOM_B)
		expect(connection.disconnect).toHaveBeenCalledTimes(1)
		expect(getBrowseSignalingToken()).toBeNull()

		await mountBrowseSignaling(ROOM_C)
		expect(Signaling.createConnection).toHaveBeenCalledTimes(2)
	})

	test('routes the browsed conversation requests to the secondary session', async () => {
		// Marked synchronously: the view starts fetching the conversation before
		// the join completes, and those requests must already be routed.
		const mounted = mountBrowseSignaling(ROOM_B)
		expect(getBrowseSessionToken()).toBe(ROOM_B)
		await mounted
		expect(getBrowseSessionToken()).toBe(ROOM_B)

		await unmountBrowseSignaling()
		expect(getBrowseSessionToken()).toBeNull()
	})

	test('keeps routing to the new conversation while the previous one is left', async () => {
		await mountBrowseSignaling(ROOM_B)

		const switched = mountBrowseSignaling(ROOM_C)
		expect(getBrowseSessionToken()).toBe(ROOM_C)
		await switched

		// Leaving ROOM_B must not clear the routing claimed by ROOM_C.
		expect(getBrowseSessionToken()).toBe(ROOM_C)
	})

	test('falls back to the primary session when there is no High-Performance Backend', async () => {
		const { fetchSignalingSettings } = await import('../../services/signalingService.js')
		fetchSignalingSettings.mockResolvedValueOnce({
			data: { ocs: { data: { signalingMode: 'internal' } } },
		})

		expect(await mountBrowseSignaling(ROOM_B)).toBe(false)
		expect(Signaling.createConnection).not.toHaveBeenCalled()
		expect(getBrowseSessionToken()).toBeNull()
		expect(getBrowseSignalingToken()).toBeNull()
	})

	test('does not leave the call conversation on the secondary session', async () => {
		await mountBrowseSignaling(ROOM_B)
		await unmountBrowseSignaling()

		const leftRooms = axios.delete.mock.calls.map(([url]) => url)
		expect(leftRooms.some((url) => url.includes(ROOM_B))).toBe(true)
		expect(leftRooms.some((url) => url.includes(CALL_ROOM))).toBe(false)
	})
})
