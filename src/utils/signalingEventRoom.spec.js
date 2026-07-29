/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { EventBus } from '../services/EventBus.ts'
import Signaling from './signaling.js'

const ROOM = 'someroom1'

describe('signaling events carry their conversation', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('appends the room the connection is in to every event', () => {
		const base = new Signaling.Base()
		base.currentRoomToken = ROOM
		const emitSpy = vi.spyOn(EventBus, 'emit')

		base._trigger('usersInRoom', [['session']])

		expect(emitSpy).toHaveBeenCalledWith('signaling-users-in-room', [['session'], ROOM])
	})

	test('events without arguments carry the room as their only argument', () => {
		const base = new Signaling.Base()
		base.currentRoomToken = ROOM
		const emitSpy = vi.spyOn(EventBus, 'emit')

		base._trigger('participantListChanged')

		expect(emitSpy).toHaveBeenCalledWith('signaling-participant-list-changed', [ROOM])
	})

	test('two connections in different conversations are told apart', () => {
		const call = new Signaling.Base()
		call.currentRoomToken = 'callroom0'
		const browse = new Signaling.Base()
		browse.currentRoomToken = 'browsed01'
		const emitSpy = vi.spyOn(EventBus, 'emit')

		call._trigger('usersChanged', [['a']])
		browse._trigger('usersChanged', [['b']])

		expect(emitSpy).toHaveBeenNthCalledWith(1, 'signaling-users-changed', [['a'], 'callroom0'])
		expect(emitSpy).toHaveBeenNthCalledWith(2, 'signaling-users-changed', [['b'], 'browsed01'])
	})

	test('local handlers keep receiving the original arguments', () => {
		const base = new Signaling.Base()
		base.currentRoomToken = ROOM
		const handler = vi.fn()
		base.on('usersLeft', handler)

		base._trigger('usersLeft', [['session']])

		expect(handler).toHaveBeenCalledWith(['session'])
	})
})
