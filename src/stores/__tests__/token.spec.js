/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test } from 'vitest'
import { useTokenStore } from '../token.ts'

const CALL_ROOM = 'callroom1'
const BROWSED_ROOM = 'browsed02'

describe('tokenStore', () => {
	let tokenStore

	beforeEach(() => {
		setActivePinia(createPinia())
		tokenStore = useTokenStore()
	})

	test('the viewed conversation is joined when the primary session is in it', () => {
		tokenStore.updateToken(CALL_ROOM)
		tokenStore.updateLastJoinedConversationToken(CALL_ROOM)

		expect(tokenStore.currentConversationIsJoined).toBe(true)
		expect(tokenStore.currentConversationIsJoinedWithCall).toBe(true)
		expect(tokenStore.currentConversationIsBrowsed).toBe(false)
	})

	test('the viewed conversation is joined when only the secondary session is in it', () => {
		// During a call the primary session stays in the call's conversation,
		// and the conversation the user opens is served by the second one.
		tokenStore.updateToken(BROWSED_ROOM)
		tokenStore.updateLastJoinedConversationToken(CALL_ROOM)
		tokenStore.browseConversationToken = BROWSED_ROOM

		expect(tokenStore.currentConversationIsJoined).toBe(true)
		expect(tokenStore.currentConversationIsBrowsed).toBe(true)
		// Only the call's own session can start a call or carry WebRTC
		expect(tokenStore.currentConversationIsJoinedWithCall).toBe(false)
	})

	test('a conversation served by neither session is not joined', () => {
		tokenStore.updateToken('another003')
		tokenStore.updateLastJoinedConversationToken(CALL_ROOM)
		tokenStore.browseConversationToken = BROWSED_ROOM

		expect(tokenStore.currentConversationIsJoined).toBe(false)
		expect(tokenStore.currentConversationIsBrowsed).toBe(false)
		expect(tokenStore.currentConversationIsJoinedWithCall).toBe(false)
	})

	test('no conversation is joined when none is viewed', () => {
		tokenStore.updateToken('')
		tokenStore.updateLastJoinedConversationToken('')
		tokenStore.browseConversationToken = ''

		expect(tokenStore.currentConversationIsJoined).toBe(false)
	})

	test('tracks the conversation the ongoing call is in', () => {
		expect(tokenStore.activeCallToken).toBe('')

		tokenStore.activeCallToken = CALL_ROOM
		// Navigating away rewrites the joined conversation, the call one stays
		tokenStore.updateToken(BROWSED_ROOM)
		tokenStore.updateLastJoinedConversationToken(BROWSED_ROOM)

		expect(tokenStore.activeCallToken).toBe(CALL_ROOM)
	})
})
