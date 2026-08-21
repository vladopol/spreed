/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createStore } from 'vuex'
import CallView from '../components/CallView/CallView.vue'
import MainView from './MainView.vue'
import router from '../__mocks__/router.js'
import { useCallViewStore } from '../stores/callView.ts'
import { useTokenStore } from '../stores/token.ts'

describe('MainView.vue', () => {
	const TOKEN = 'XXTOKENXX'
	const CALL_TOKEN = 'XXCALLTOKENXX'

	let store
	let callViewStore
	let tokenStore

	beforeAll(() => {
		// A single pinia for the whole file: the composables used by MainView
		// are shared (createSharedComposable) and bind to the first instance
		setActivePinia(createPinia())

		store = createStore({
			state: { isInLobby: false },
			getters: {
				isInLobby: (state) => state.isInLobby,
				connectionFailed: () => () => false,
				conversation: () => () => ({ token: TOKEN, type: 2 }),
				isInCall: () => () => false,
			},
		})
	})

	beforeEach(() => {
		callViewStore = useCallViewStore()
		tokenStore = useTokenStore()
		callViewStore.setIsViewerOverlay(false)
		callViewStore.setForceCallView(false)
		tokenStore.token = TOKEN
		tokenStore.activeCallToken = ''
		store.state.isInLobby = false
	})

	/**
	 * @param {string} token conversation shown by the view
	 */
	function mountMainView(token) {
		return shallowMount(MainView, {
			props: { token },
			global: {
				plugins: [store, router],
			},
		})
	}

	describe('call in another conversation', () => {
		it('keeps the ongoing call on screen while another conversation is browsed', async () => {
			tokenStore.activeCallToken = CALL_TOKEN

			const wrapper = mountMainView(TOKEN)
			await nextTick()

			const callView = wrapper.findComponent(CallView)
			expect(callView.exists()).toBe(true)
			expect(callView.props('token')).toBe(CALL_TOKEN)
		})

		it('keeps it on screen in a conversation whose lobby blocks the chat', async () => {
			tokenStore.activeCallToken = CALL_TOKEN
			store.state.isInLobby = true

			const wrapper = mountMainView(TOKEN)
			await nextTick()

			const callView = wrapper.findComponent(CallView)
			expect(callView.exists()).toBe(true)
			expect(callView.props('token')).toBe(CALL_TOKEN)
		})

		it('does not add a second call view when the call is in the viewed conversation', async () => {
			tokenStore.activeCallToken = TOKEN

			const wrapper = mountMainView(TOKEN)
			await nextTick()

			expect(wrapper.findComponent(CallView).exists()).toBe(false)
		})

		it('does not show a call view when there is no call at all', async () => {
			const wrapper = mountMainView(TOKEN)
			await nextTick()

			expect(wrapper.findComponent(CallView).exists()).toBe(false)
		})

		it('removes the overlay once the call ends', async () => {
			tokenStore.activeCallToken = CALL_TOKEN

			const wrapper = mountMainView(TOKEN)
			await nextTick()
			expect(wrapper.findComponent(CallView).exists()).toBe(true)

			// The call ends, possibly remotely
			tokenStore.activeCallToken = ''
			await nextTick()

			expect(wrapper.findComponent(CallView).exists()).toBe(false)
		})

		it('follows the call when it moves to another conversation', async () => {
			tokenStore.activeCallToken = CALL_TOKEN

			const wrapper = mountMainView(TOKEN)
			await nextTick()

			// The call is moved, e.g. into a breakout room
			const OTHER_CALL_TOKEN = 'XXBREAKOUTXX'
			tokenStore.activeCallToken = OTHER_CALL_TOKEN
			await nextTick()

			expect(wrapper.findComponent(CallView).props('token')).toBe(OTHER_CALL_TOKEN)
		})
	})
})
