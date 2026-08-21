/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
	 * @param {object} options mounting options
	 * @param {HTMLElement} [options.attachTo] element to mount the overlay into
	 */
	function mountOverlay(token, { attachTo } = {}) {
		return mount(ViewerOverlayCallView, {
			attachTo,
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
	describe('positioning', () => {
		const CHAT_MESSAGES_BOTTOM = 500

		let mainView

		beforeEach(() => {
			mainView = document.createElement('div')
			mainView.className = 'main-view'
			document.body.appendChild(mainView)
		})

		afterEach(() => {
			mainView.remove()
		})

		/**
		 * The chat of the browsed conversation, ending above its message input.
		 */
		function addChatMessagesArea() {
			const chatMessagesArea = document.createElement('div')
			chatMessagesArea.className = 'messages-list-dragover-wrapper'
			chatMessagesArea.getBoundingClientRect = () => ({ bottom: CHAT_MESSAGES_BOTTOM })
			mainView.appendChild(chatMessagesArea)

			return chatMessagesArea
		}

		it('sits above the message input of the browsed conversation', () => {
			tokenStore.token = TOKEN
			addChatMessagesArea()

			const wrapper = mountOverlay(CALL_TOKEN, { attachTo: mainView })

			expect(wrapper.vm.isAboveChatInput).toBe(true)
			expect(wrapper.vm.position.bottom).toBe(window.innerHeight - CHAT_MESSAGES_BOTTOM)

			wrapper.unmount()
		})

		it('follows the message input when it grows', async () => {
			tokenStore.token = TOKEN
			const chatMessagesArea = addChatMessagesArea()

			const wrapper = mountOverlay(CALL_TOKEN, { attachTo: mainView })
			chatMessagesArea.getBoundingClientRect = () => ({ bottom: CHAT_MESSAGES_BOTTOM - 100 })
			wrapper.vm.updatePosition()

			expect(wrapper.vm.position.bottom).toBe(window.innerHeight - CHAT_MESSAGES_BOTTOM + 100)

			wrapper.unmount()
		})

		it('keeps the position of the ghost when the call conversation is viewed', () => {
			tokenStore.token = CALL_TOKEN
			addChatMessagesArea()

			const wrapper = mountOverlay(CALL_TOKEN, { attachTo: mainView })

			// The ghost is not laid out in jsdom, so it reports an empty rect
			expect(wrapper.vm.isAboveChatInput).toBe(false)
			expect(wrapper.vm.position.bottom).toBe(window.innerHeight)

			wrapper.unmount()
		})

		it('falls back to the ghost when the conversation has no chat', () => {
			tokenStore.token = TOKEN

			const wrapper = mountOverlay(CALL_TOKEN, { attachTo: mainView })

			expect(wrapper.vm.isAboveChatInput).toBe(false)
			expect(wrapper.vm.position.bottom).toBe(window.innerHeight)

			wrapper.unmount()
		})
	})
	// The overlay is made to sit on top of the viewer, but nothing else layered
	// over a browsed conversation should be covered by the call
	describe('stacking', () => {
		afterEach(() => {
			// The "viewer is open" state is shared app-wide
			document.querySelectorAll('.viewer-overlay').forEach((overlay) => overlay.remove())
		})

		it('goes behind dialogs while another conversation is browsed', () => {
			tokenStore.token = TOKEN

			const wrapper = mountOverlay(CALL_TOKEN)

			expect(wrapper.vm.isBelowDialogs).toBe(true)
			expect(document.querySelector('.viewer-overlay--below-dialogs')).not.toBe(null)

			wrapper.unmount()
		})

		it('stays on top while the viewer is open', async () => {
			tokenStore.token = TOKEN

			const wrapper = mountOverlay(CALL_TOKEN)
			wrapper.vm.isViewerOpen = true
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.isBelowDialogs).toBe(false)
			expect(document.querySelector('.viewer-overlay--below-dialogs')).toBe(null)

			wrapper.vm.isViewerOpen = false
			wrapper.unmount()
		})

		it('stays on top when it is the overlay of the viewer', () => {
			tokenStore.token = CALL_TOKEN

			const wrapper = mountOverlay(CALL_TOKEN)

			expect(wrapper.vm.isBelowDialogs).toBe(false)

			wrapper.unmount()
		})
	})
})
