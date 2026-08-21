/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'vuex'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import ScreenShare from './ScreenShare.vue'

vi.mock('panzoom', () => ({
	default: vi.fn(() => ({
		on: vi.fn(),
		dispose: vi.fn(),
		getTransform: vi.fn(() => ({ x: 0, y: 0, scale: 1 })),
	})),
}))

vi.mock('../../../utils/attachmediastream.js', () => ({
	default: vi.fn(),
}))

describe('ScreenShare.vue', () => {
	const TOKEN = 'XXTOKENXX'

	let store

	beforeEach(() => {
		setActivePinia(createPinia())

		store = createStore({
			getters: {
				conversation: () => () => ({ token: TOKEN }),
			},
		})
	})

	/**
	 * @param {boolean} isBig whether the screen is the big one of the call view
	 */
	function mountLocalScreenShare(isBig) {
		return mount(ScreenShare, {
			props: {
				token: TOKEN,
				isBig,
				localMediaModel: {
					attributes: { localScreen: {} },
				},
				sharedData: {},
			},
			global: {
				plugins: [store],
				stubs: {
					VideoBottomBar: true,
				},
			},
		})
	}

	describe('mirroring placeholder', () => {
		it('warns about the mirroring effect over the big screen', async () => {
			const wrapper = mountLocalScreenShare(true)
			// The placeholder is only known to be needed once the screen is set
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.showScreenPlaceholder).toBe(true)
			expect(wrapper.findComponent(NcEmptyContent).exists()).toBe(true)
		})

		// It does not fit in a small preview, like the one of the call overlay
		// shown while another conversation is browsed during a call, where it
		// would overlap the controls of the overlay
		it('does not warn in a small preview', async () => {
			const wrapper = mountLocalScreenShare(false)
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.showScreenPlaceholder).toBe(true)
			expect(wrapper.findComponent(NcEmptyContent).exists()).toBe(false)
		})
	})
})
