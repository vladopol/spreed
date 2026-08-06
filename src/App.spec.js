/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'vuex'
import { useTokenStore } from './stores/token.ts'

// Layout wrappers only: they pull the whole @nextcloud/vue app shell, which is
// irrelevant for the routing behaviour under test
vi.mock('@nextcloud/vue/components/NcContent', () => ({
	default: { name: 'NcContent', template: '<div><slot /></div>' },
}))
vi.mock('@nextcloud/vue/components/NcAppContent', () => ({
	default: { name: 'NcAppContent', template: '<div><slot /></div>' },
}))

vi.mock('./utils/webrtc/browseSignaling.js', () => ({
	mountBrowseSignaling: vi.fn(),
	unmountBrowseSignaling: vi.fn(),
	destroyBrowseSignaling: vi.fn(),
}))

// @nextcloud/vue reads this as a bundler-injected global; the test setup only
// provides appName, and the components App renders check for both
global.appVersion = '1.0.0'

const { default: App } = await import('./App.vue')
const { default: router } = await import('./__mocks__/router.js')
const {
	destroyBrowseSignaling,
	mountBrowseSignaling,
	unmountBrowseSignaling,
} = await import('./utils/webrtc/browseSignaling.js')

describe('App.vue', () => {
	const TOKEN = 'XXTOKENXX'
	const CALL_TOKEN = 'XXCALLTOKENXX'
	const OTHER_TOKEN = 'XXOTHERTOKENXX'

	let store
	let joinConversation
	let leaveConversation
	let tokenStore
	let wrapper
	let guard
	let knownConversation

	/**
	 * @param {string} token conversation token
	 */
	function route(token) {
		return {
			name: 'conversation',
			params: { token },
			fullPath: `/call/${token}`,
		}
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		setActivePinia(createPinia())
		tokenStore = useTokenStore()

		joinConversation = vi.fn()
		leaveConversation = vi.fn()
		// Every conversation is known to the client unless a test says otherwise
		knownConversation = (token) => ({ token })
		store = createStore({
			getters: {
				conversationsList: () => [],
				isSendingMessages: () => false,
				conversation: () => (token) => knownConversation(token),
				getUserId: () => 'alice',
				findParticipant: () => () => undefined,
				isInCall: () => () => false,
				isInLobby: () => false,
				message: () => () => undefined,
			},
			actions: {
				joinConversation,
				leaveConversation,
				// Dispatched by the composables App sets up; irrelevant here
				addConversation: vi.fn(),
				cancelPollNewMessages: vi.fn(),
				fetchConversation: vi.fn(),
				fetchMessages: vi.fn(),
				forceJoinConversation: vi.fn(),
				getMessageContext: vi.fn(),
				joinCall: vi.fn(),
				loadedMessagesOfConversation: vi.fn(),
				pollNewMessages: vi.fn(),
				processMessage: vi.fn(),
				removeExpiredMessages: vi.fn(),
				setConversationProperties: vi.fn(),
				setVisualLastReadMessageId: vi.fn(),
				updateCallStateFromNotification: vi.fn(),
				updateConversationLastMessageFromNotification: vi.fn(),
				updateLastCommonReadMessage: vi.fn(),
			},
		})

		const beforeEachSpy = vi.spyOn(router, 'beforeEach')
		// App calls next() in its guards, which vue-router logs as deprecated;
		// the test setup turns any warning into a thrown error, so the initial
		// navigation triggered by installing the router has to be quiet
		const consoleWarn = console.warn
		console.warn = vi.fn()
		wrapper = shallowMount(App, { global: { plugins: [store, router] } })
		await router.isReady()
		console.warn = consoleWarn

		// The global before guard App registers on creation
		guard = beforeEachSpy.mock.calls.at(-1)[0]
		beforeEachSpy.mockRestore()
		// Drop whatever the initial navigation did
		vi.clearAllMocks()
	})

	describe('navigating during a call', () => {
		it('browses another conversation without leaving the call', async () => {
			tokenStore.activeCallToken = CALL_TOKEN
			const next = vi.fn()

			guard(route(OTHER_TOKEN), route(CALL_TOKEN), next)
			await flushPromises()

			// The call's conversation is neither left nor re-joined
			expect(leaveConversation).not.toHaveBeenCalled()
			expect(joinConversation).not.toHaveBeenCalled()
			expect(next).toHaveBeenCalled()
		})

		it('connects the second signaling session to the browsed conversation', async () => {
			tokenStore.activeCallToken = CALL_TOKEN

			guard(route(OTHER_TOKEN), route(CALL_TOKEN), vi.fn())
			await flushPromises()

			expect(mountBrowseSignaling).toHaveBeenCalledWith(OTHER_TOKEN)
		})

		it('keeps that session alive when returning to the call', async () => {
			tokenStore.activeCallToken = CALL_TOKEN

			guard(route(CALL_TOKEN), route(OTHER_TOKEN), vi.fn())
			await flushPromises()

			// Unmounted from the browsed room, but not destroyed: the next
			// conversation reuses it
			expect(unmountBrowseSignaling).toHaveBeenCalled()
			expect(destroyBrowseSignaling).not.toHaveBeenCalled()
			expect(leaveConversation).not.toHaveBeenCalled()
		})

		it('does not intercept navigation when the call moves to another conversation', async () => {
			tokenStore.activeCallToken = CALL_TOKEN
			// A breakout room, or the group a one-to-one was extended into
			wrapper.vm.callMigrationToken = OTHER_TOKEN

			guard(route(OTHER_TOKEN), route(CALL_TOKEN), vi.fn())
			await flushPromises()

			expect(mountBrowseSignaling).not.toHaveBeenCalled()
			expect(destroyBrowseSignaling).toHaveBeenCalled()
			// The target has to be joined for real, so the call can move there
			expect(joinConversation).toHaveBeenCalled()
		})
	})

	describe('browsing a conversation the client does not know yet', () => {
		it('fetches it before browsing it', async () => {
			tokenStore.activeCallToken = CALL_TOKEN
			knownConversation = (token) => (token === OTHER_TOKEN ? undefined : { token })
			const fetchSingleConversation = vi.spyOn(wrapper.vm, 'fetchSingleConversation')
				.mockResolvedValue(true)

			guard(route(OTHER_TOKEN), route(CALL_TOKEN), vi.fn())
			await flushPromises()

			expect(fetchSingleConversation).toHaveBeenCalledWith(OTHER_TOKEN)
			expect(mountBrowseSignaling).toHaveBeenCalledWith(OTHER_TOKEN)
		})

		it('blocks the navigation when it cannot be fetched', async () => {
			tokenStore.activeCallToken = CALL_TOKEN
			knownConversation = (token) => (token === OTHER_TOKEN ? undefined : { token })
			vi.spyOn(wrapper.vm, 'fetchSingleConversation').mockResolvedValue(false)
			const next = vi.fn()

			guard(route(OTHER_TOKEN), route(CALL_TOKEN), next)
			await flushPromises()

			// The call must not be left behind for a conversation that cannot be shown
			expect(mountBrowseSignaling).not.toHaveBeenCalled()
			expect(next).not.toHaveBeenCalled()
		})
	})

	describe('navigating without a call', () => {
		it('leaves the previous conversation and joins the next one', async () => {
			tokenStore.activeCallToken = ''

			guard(route(OTHER_TOKEN), route(TOKEN), vi.fn())
			await flushPromises()

			expect(leaveConversation).toHaveBeenCalled()
			expect(leaveConversation.mock.calls[0][1]).toMatchObject({ token: TOKEN })
			expect(joinConversation).toHaveBeenCalled()
			expect(joinConversation.mock.calls[0][1]).toMatchObject({ token: OTHER_TOKEN })
		})

		it('does not touch the second signaling session', async () => {
			tokenStore.activeCallToken = ''

			guard(route(OTHER_TOKEN), route(TOKEN), vi.fn())
			await flushPromises()

			expect(mountBrowseSignaling).not.toHaveBeenCalled()
			expect(unmountBrowseSignaling).not.toHaveBeenCalled()
		})
	})
})
