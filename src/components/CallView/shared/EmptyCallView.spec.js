/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createStore } from 'vuex'
import EmptyCallView from './EmptyCallView.vue'
import router from '../../../__mocks__/router.js'
import { CONVERSATION } from '../../../constants.ts'

describe('EmptyCallView.vue', () => {
	const TOKEN = 'XXTOKENXX'
	const CALL_TOKEN = 'XXCALLTOKENXX'

	const conversations = {
		[TOKEN]: { token: TOKEN, type: CONVERSATION.TYPE.ONE_TO_ONE, displayName: 'Browsed user' },
		[CALL_TOKEN]: { token: CALL_TOKEN, type: CONVERSATION.TYPE.ONE_TO_ONE, displayName: 'Called user' },
	}

	let store

	beforeEach(async () => {
		setActivePinia(createPinia())

		store = createStore({
			getters: {
				conversation: () => (token) => conversations[token],
				isConnecting: () => () => false,
			},
		})

		await router.replace({ name: 'conversation', params: { token: TOKEN } })
	})

	/**
	 * @param {object} props properties of the view
	 */
	function mountEmptyCallView(props = {}) {
		return mount(EmptyCallView, {
			props,
			global: {
				plugins: [store, router],
			},
		})
	}

	it('waits for the user of the call conversation, not of the viewed one', () => {
		const wrapper = mountEmptyCallView({ token: CALL_TOKEN })

		expect(wrapper.find('h2').text()).toBe('Waiting for Called user to join the call')
	})

	it('falls back to the viewed conversation without a token', () => {
		const wrapper = mountEmptyCallView()

		expect(wrapper.find('h2').text()).toBe('Waiting for Browsed user to join the call')
	})
})
