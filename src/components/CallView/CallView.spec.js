/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { reactive } from 'vue'
import { createStore } from 'vuex'
import CallView from './CallView.vue'
import ScreenShare from './shared/ScreenShare.vue'
import ViewerOverlayCallView from './shared/ViewerOverlayCallView.vue'
import { useCallViewStore } from '../../stores/callView.ts'
import { useTokenStore } from '../../stores/token.ts'
import { callParticipantCollection, localCallParticipantModel, localMediaModel } from '../../utils/webrtc/index.js'

vi.mock('@nextcloud/event-bus', () => ({
	EventBus: {
		on: vi.fn(),
		off: vi.fn(),
	},
	emit: vi.fn(),
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
}))

// The tile animation reads the motion preference through matchMedia, which
// jsdom does not have
vi.mock('./Grid/tilePromotionTransition.ts', () => ({
	TILE_SESSION_ATTRIBUTE: 'data-tile-session-id',
	animateTilePromotion: vi.fn(),
}))

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

	// Upstream's tests of the overlay activity tracking mount the whole call
	// view with its children stubbed out
	let wrapper

	afterEach(() => {
		wrapper?.unmount()
		wrapper = undefined
	})

	const mountCallViewWithStubs = (props = {}) => {
		return mount(CallView, {
			props: {
				token: TOKEN,
				...props,
			},
			global: {
				plugins: [store],
				stubs: {
					ViewerOverlayCallView: true,
					EmptyCallView: true,
					VideoVue: true,
					LocalVideo: true,
					ScreenShare: true,
					PresenterOverlay: true,
					VideosGrid: true,
					ReactionToaster: true,
					LiveTranscriptionRenderer: true,
					BottomBar: true,
				},
			},
		})
	}

	describe('video overlay mouse/keyboard activity tracking', () => {
		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.restoreAllMocks()
			vi.useRealTimers()
		})

		test('showVideoOverlay becomes false after 5000ms of inactivity', async () => {
			wrapper = mountCallViewWithStubs()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Trigger activity to start the timer
			await wrapper.find('div#call-container').trigger('mousemove')

			vi.advanceTimersByTime(5000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)
		})

		test('handleMovement resets the timer', async () => {
			wrapper = mountCallViewWithStubs()

			// Start the initial timer
			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Advance 3 seconds
			vi.advanceTimersByTime(3000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Call handleMovement to reset timer
			await wrapper.find('div#call-container').trigger('mousemove')

			// Still visible
			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Advance another 3 seconds (6 total from start, but 3 from reset)
			vi.advanceTimersByTime(3000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			// Advance final 2 seconds (5 from the reset)
			vi.advanceTimersByTime(2000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)
		})

		test('handleMovement sets showVideoOverlay to true', async () => {
			wrapper = mountCallViewWithStubs()

			// Start the timer
			await wrapper.find('div#call-container').trigger('mousemove')

			// Let the overlay hide
			vi.advanceTimersByTime(5000)
			await flushPromises()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)

			// Call handleMovement again
			await wrapper.find('div#call-container').trigger('mousemove')

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)
		})

		test('hideOverlay immediately sets showVideoOverlay to false', async () => {
			wrapper = mountCallViewWithStubs()

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(true)

			await wrapper.find('div#call-container').trigger('mouseleave')

			expect(wrapper.findComponent({ name: 'VideosGrid' }).props('showVideoOverlay')).toBe(false)
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
