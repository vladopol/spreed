/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createStore } from 'vuex'
import CallView from './CallView.vue'
import ScreenShare from './shared/ScreenShare.vue'
import ViewerOverlayCallView from './shared/ViewerOverlayCallView.vue'
import { useCallViewStore } from '../../stores/callView.ts'
import { useTokenStore } from '../../stores/token.ts'
import { callParticipantCollection, localCallParticipantModel, localMediaModel } from '../../utils/webrtc/index.js'

vi.mock('../../utils/webrtc/index.js', () => ({
	callParticipantCollection: {
		callParticipantModels: reactive([]),
		on: vi.fn(),
		off: vi.fn(),
	},
	localCallParticipantModel: {
		attributes: reactive({ peerId: 'local-peer-id' }),
	},
	localMediaModel: {
		attributes: reactive({
			localScreen: null,
			videoEnabled: false,
			audioEnabled: false,
		}),
		disableAudio: vi.fn(),
		disableVideo: vi.fn(),
	},
	consumeStartWithoutMediaPending: vi.fn(() => false),
}))

describe('CallView.vue', () => {
	const TOKEN = 'XXTOKENXX'

	let store
	let tokenStore
	let callViewStore

	beforeAll(() => {
		// A single pinia for the whole file: the call views mounted by the
		// tests keep running and would otherwise write to a stale one
		setActivePinia(createPinia())

		tokenStore = useTokenStore()
		callViewStore = useCallViewStore()

		store = createStore({
			getters: {
				conversation: () => () => ({ token: TOKEN }),
			},
		})
	})

	beforeEach(() => {
		callViewStore.$reset()
		// The call view of the viewed conversation, as opposed to the overlay
		// shown while another conversation is browsed
		tokenStore.token = TOKEN

		callParticipantCollection.callParticipantModels.splice(0)
		localMediaModel.attributes.localScreen = null
		localMediaModel.attributes.videoEnabled = false
	})

	/**
	 * A minimal stand-in for a CallParticipantModel.
	 *
	 * @param {string} peerId peer id of the participant
	 * @param {object} attributes attributes to set besides the peer id
	 */
	function addCallParticipantModel(peerId, attributes = {}) {
		const model = {
			attributes: reactive({
				peerId,
				name: peerId,
				screen: null,
				videoAvailable: false,
				audioAvailable: false,
				internal: false,
				...attributes,
			}),
			setVideoBlocked: vi.fn(),
			setSimulcastVideoQuality: vi.fn(),
		}

		callParticipantCollection.callParticipantModels.push(model)

		return model
	}

	/**
	 * @param {string} token conversation the call is in
	 */
	function mountCallView(token = TOKEN) {
		return shallowMount(CallView, {
			props: { token },
			global: {
				plugins: [store],
			},
		})
	}

	// The call view is created again during an ongoing call when coming back to
	// it after browsing another conversation, so whatever is shared at that
	// point was shared before the call view existed.
	describe('screens shared before the call view is created', () => {
		it('shows a remote screen shared before the call view was created', () => {
			addCallParticipantModel('peer-id', { screen: {} })

			const wrapper = mountCallView()

			expect(wrapper.vm.screens).toEqual(['peer-id'])
			expect(wrapper.vm.showRemoteScreen).toBe(true)
			expect(wrapper.findComponent(ScreenShare).exists()).toBe(true)
		})

		it('shows a local screen shared before the call view was created', () => {
			localMediaModel.attributes.localScreen = {}

			const wrapper = mountCallView()

			expect(wrapper.vm.screens).toEqual([localCallParticipantModel.attributes.peerId])
			expect(wrapper.vm.showLocalScreen).toBe(true)
		})

		it('marks the shown screen as visible', () => {
			addCallParticipantModel('peer-id', { screen: {} })

			const wrapper = mountCallView()

			expect(wrapper.vm.sharedDatas['peer-id'].screenVisible).toBe(true)
			expect(wrapper.vm.localSharedData.screenVisible).toBe(false)
		})

		it('does not report a screen when none is shared', () => {
			addCallParticipantModel('peer-id')

			const wrapper = mountCallView()

			expect(wrapper.vm.screens).toEqual([])
			expect(wrapper.vm.showRemoteScreen).toBe(false)
		})
	})

	describe('screens shared while the call view exists', () => {
		it('shows a screen started after the call view was created', async () => {
			const model = addCallParticipantModel('peer-id')
			const wrapper = mountCallView()

			model.attributes.screen = {}
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.screens).toEqual(['peer-id'])
		})

		it('lists a screen only once when its stream is replaced', async () => {
			const model = addCallParticipantModel('peer-id', { screen: {} })
			const wrapper = mountCallView()

			model.attributes.screen = {}
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.screens).toEqual(['peer-id'])
		})

		it('removes the screen when the sharing stops', async () => {
			const model = addCallParticipantModel('peer-id', { screen: {} })
			const wrapper = mountCallView()

			model.attributes.screen = null
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.screens).toEqual([])
		})
	})

	// The call view of a conversation that is not the viewed one belongs to a
	// call whose conversation is not on screen, which is only ever shown as the
	// compact overlay
	describe('overlay while another conversation is browsed', () => {
		const BROWSED_TOKEN = 'XXBROWSEDXX'

		it('shows the call as the overlay when another conversation is viewed', () => {
			tokenStore.token = BROWSED_TOKEN

			const wrapper = mountCallView()

			expect(wrapper.vm.isViewerOverlay).toBe(true)
			expect(wrapper.findComponent(ViewerOverlayCallView).exists()).toBe(true)
		})

		it('keeps it as the overlay when the viewer clears the flag', async () => {
			tokenStore.token = BROWSED_TOKEN

			const wrapper = mountCallView()
			// Closing the viewer in the browsed conversation clears the flag
			callViewStore.setIsViewerOverlay(false)
			await wrapper.vm.$nextTick()

			expect(wrapper.vm.isViewerOverlay).toBe(true)
			expect(wrapper.findComponent(ViewerOverlayCallView).exists()).toBe(true)
		})

		it('shows the full call view in the conversation of the call', () => {
			const wrapper = mountCallView()

			expect(wrapper.vm.isViewerOverlay).toBe(false)
			expect(wrapper.findComponent(ViewerOverlayCallView).exists()).toBe(false)
		})
	})

	// The stripe is collapsed automatically only for a starting screen share.
	// Picking someone to follow is not that: what the user opened by hand has
	// to stay open.
	describe('following a participant', () => {
		it('promotes the participant and leaves the grid', () => {
			addCallParticipantModel('peer-id')
			callViewStore.setCallViewMode({ token: TOKEN, isGrid: true })
			const wrapper = mountCallView()

			wrapper.vm.handleSelectVideo('peer-id')

			expect(callViewStore.selectedVideoPeerId).toBe('peer-id')
			expect(callViewStore.isGrid).toBe(false)
		})

		it('keeps the stripe open', () => {
			addCallParticipantModel('peer-id')
			const wrapper = mountCallView()

			wrapper.vm.handleSelectVideo('peer-id')

			expect(callViewStore.isStripeOpen).toBe(true)
		})

		it('keeps the stripe collapsed when the user collapsed it', () => {
			addCallParticipantModel('peer-id')
			callViewStore.setCallViewMode({ token: TOKEN, isStripeOpen: false })
			const wrapper = mountCallView()

			wrapper.vm.handleSelectVideo('peer-id')

			expect(callViewStore.isStripeOpen).toBe(false)
		})

		it('keeps the stripe open when following own video', () => {
			localMediaModel.attributes.videoEnabled = true
			const wrapper = mountCallView()

			wrapper.vm.handleClickLocalVideo()

			expect(callViewStore.selectedVideoPeerId).toBe('local')
			expect(callViewStore.isGrid).toBe(false)
			expect(callViewStore.isStripeOpen).toBe(true)
		})
	})
})
