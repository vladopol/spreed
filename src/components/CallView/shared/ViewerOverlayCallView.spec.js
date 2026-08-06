/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'vuex'
import NcButton from '@nextcloud/vue/components/NcButton'
import ViewerOverlayCallView from './ViewerOverlayCallView.vue'
import router from '../../../__mocks__/router.js'
import { useActorStore } from '../../../stores/actor.ts'
import { useTokenStore } from '../../../stores/token.ts'
import { findNcButton } from '../../../test-helpers.js'

describe('ViewerOverlayCallView.vue', () => {
	const TOKEN = 'XXTOKENXX'
	const CALL_TOKEN = 'XXCALLTOKENXX'

	let store
	let leaveCallAction
	let tokenStore
	let actorStore

	beforeEach(() => {
		setActivePinia(createPinia())
		tokenStore = useTokenStore()
		actorStore = useActorStore()
		actorStore.actorId = 'alice'
		actorStore.sessionId = 'session-id-alice'

		leaveCallAction = vi.fn()
		store = createStore({
			getters: {
				conversation: () => () => ({ token: CALL_TOKEN }),
			},
			actions: {
				leaveCall: leaveCallAction,
			},
		})
	})

	/**
	 * @param {string} token conversation the call belongs to
	 */
	function mountOverlay(token) {
		return mount(ViewerOverlayCallView, {
			props: {
				token,
				localModel: { attributes: { videoEnabled: false, localScreen: null } },
				localCallParticipantModel: { attributes: { peerId: 'peer-id' } },
				localSharedData: {},
			},
			global: {
				plugins: [store, router],
				stubs: {
					EmptyCallView: true,
					LocalAudioControlButton: true,
					LocalVideoControlButton: true,
					LocalVideo: true,
					ScreenShare: true,
					VideoVue: true,
				},
			},
		})
	}

	describe('leaving the call from the overlay', () => {
		it('offers to leave the call while another conversation is browsed', () => {
			tokenStore.token = TOKEN

			const wrapper = mountOverlay(CALL_TOKEN)

			expect(findNcButton(wrapper, 'Leave call').exists()).toBe(true)
		})

		it('does not offer it when the call conversation itself is viewed', () => {
			tokenStore.token = CALL_TOKEN

			const wrapper = mountOverlay(CALL_TOKEN)

			expect(findNcButton(wrapper, 'Leave call').exists()).toBe(false)
		})

		it('leaves the call of the overlaid conversation, not of the browsed one', async () => {
			tokenStore.token = TOKEN

			const wrapper = mountOverlay(CALL_TOKEN)
			await findNcButton(wrapper, 'Leave call').trigger('click')
			await flushPromises()

			expect(leaveCallAction).toHaveBeenCalledTimes(1)
			expect(leaveCallAction.mock.calls[0][1]).toMatchObject({ token: CALL_TOKEN })
		})
	})

	/**
	 * The button that maximises the call, as opposed to the collapse toggle,
	 * which carries the same label while the overlay is expanded.
	 *
	 * @param {object} wrapper mounted overlay
	 */
	function findMaximiseButton(wrapper) {
		const buttons = wrapper.findAllComponents(NcButton)
			.filter((button) => button.vm.ariaLabel === 'Expand')
		return buttons[buttons.length - 1]
	}

	describe('maximising the overlay', () => {
		it('navigates back to the conversation the call is in', async () => {
			tokenStore.token = TOKEN
			const push = vi.spyOn(router, 'push').mockResolvedValue()

			const wrapper = mountOverlay(CALL_TOKEN)
			await findMaximiseButton(wrapper).trigger('click')

			expect(push).toHaveBeenCalledWith({
				name: 'conversation',
				params: { token: CALL_TOKEN },
			})
			push.mockRestore()
		})

		it('does not navigate when the call conversation is already viewed', async () => {
			tokenStore.token = CALL_TOKEN
			const push = vi.spyOn(router, 'push').mockResolvedValue()

			const wrapper = mountOverlay(CALL_TOKEN)
			await findMaximiseButton(wrapper).trigger('click')

			expect(push).not.toHaveBeenCalled()
			push.mockRestore()
		})
	})
})
