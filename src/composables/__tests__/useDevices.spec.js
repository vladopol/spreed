/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PARTICIPANT } from '../../constants.ts'

const { createHark, mediaDevicesManager } = vi.hoisted(() => ({
	createHark: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), stop: vi.fn() })),
	mediaDevicesManager: {
		attributes: {
			devices: [],
			audioInputId: 'audio-input-id',
			audioOutputId: 'audio-output-id',
			videoInputId: 'video-input-id',
		},
		isSupported: vi.fn(() => true),
		isAudioOutputSelectSupported: true,
		enableDeviceEvents: vi.fn(),
		disableDeviceEvents: vi.fn(),
		getUserMedia: vi.fn(),
		_updateDevices: vi.fn(),
		updatePreferences: vi.fn(),
		get: vi.fn(),
		set: vi.fn(),
	},
}))

vi.mock('hark', () => ({ default: createHark }))

vi.mock('../../utils/webrtc/index.js', () => ({
	mediaDevicesManager,
	callParticipantsAudioPlayer: null,
}))

vi.mock('../../stores/sounds.js', () => ({
	useSoundsStore: () => ({
		audioOutputDeviceId: 'audio-output-id',
		setGeneralAudioOutput: vi.fn(),
	}),
}))

vi.mock('../../utils/attachmediastream.js', () => ({ default: vi.fn() }))

vi.mock('../../utils/media/pipeline/VirtualBackground.js', () => ({
	default: vi.fn(function() {
		this.setEnabled = vi.fn()
		this.connectTrackSink = vi.fn()
		this.destroy = vi.fn()
		this._setInputTrack = vi.fn()
	}),
}))

vi.mock('../../utils/media/pipeline/TrackToStream.js', () => ({
	default: vi.fn(function() {
		this.addInputTrackSlot = vi.fn()
		this.getStream = vi.fn()
	}),
}))

/**
 * Builds a fake MediaStream with a single track of the given kind.
 *
 * @param {string} kind track kind, 'audio' or 'video'
 * @return {object} the fake stream
 */
function newStream(kind) {
	const track = { kind, stop: vi.fn(), getSettings: () => ({ deviceId: kind + '-input-id' }) }

	return {
		getTracks: () => [track],
		getAudioTracks: () => (kind === 'audio' ? [track] : []),
		getVideoTracks: () => (kind === 'video' ? [track] : []),
	}
}

describe('useDevices', () => {
	let useDevices

	beforeEach(async () => {
		vi.clearAllMocks()
		mediaDevicesManager.getUserMedia.mockImplementation((constraints) => {
			return Promise.resolve(newStream(constraints.audio ? 'audio' : 'video'))
		})

		// The composable keeps the subscribers in the module scope, so the
		// module has to be reset to start from a clean state on each test.
		vi.resetModules()
		useDevices = (await import('../useDevices.js')).useDevices
	})

	/**
	 * Returns the constraint kinds "getUserMedia" was called with so far.
	 *
	 * @return {Array<string>} 'audio' or 'video' for each call
	 */
	function grabbedMedia() {
		return mediaDevicesManager.getUserMedia.mock.calls
			.map(([constraints]) => (constraints.audio ? 'audio' : 'video'))
	}

	test('grabs the devices for subscribers that need a preview', async () => {
		const { subscribeToDevices } = useDevices()

		subscribeToDevices(PARTICIPANT.PERMISSIONS.MAX_DEFAULT)
		await vi.waitFor(() => expect(grabbedMedia()).toEqual(expect.arrayContaining(['audio', 'video'])))
	})

	test('does not grab the devices for subscribers that do not need a preview', async () => {
		const { subscribeToDevices } = useDevices()

		// As done by the in-call control buttons, which only need the list of
		// devices: the microphone and the camera are already grabbed by the
		// call itself.
		subscribeToDevices(PARTICIPANT.PERMISSIONS.MAX_DEFAULT, { videoPreview: false, audioPreview: false })

		await vi.waitFor(() => expect(mediaDevicesManager.enableDeviceEvents).toHaveBeenCalled())
		expect(grabbedMedia()).toEqual([])
	})

	test('does not grab the devices again when the in-call subscribers are mounted again', async () => {
		const permissions = PARTICIPANT.PERMISSIONS.MAX_DEFAULT
		const options = { videoPreview: false, audioPreview: false }
		const { subscribeToDevices, unsubscribeFromDevices } = useDevices()

		subscribeToDevices(permissions, options)
		await vi.waitFor(() => expect(mediaDevicesManager.enableDeviceEvents).toHaveBeenCalled())

		// Browsing another conversation during the call unmounts the call view,
		// and coming back to the call mounts it again. Neither may grab the
		// microphone, as "getUserMedia" can stop the microphone track used by
		// the ongoing call, which would mute the user.
		unsubscribeFromDevices(permissions, options)
		subscribeToDevices(permissions, options)

		await vi.waitFor(() => expect(mediaDevicesManager.enableDeviceEvents).toHaveBeenCalledTimes(2))
		expect(grabbedMedia()).toEqual([])
	})

	test('stops the preview once the last subscriber needing it is gone', async () => {
		const inCallOptions = { videoPreview: false, audioPreview: false }
		const { subscribeToDevices, unsubscribeFromDevices } = useDevices()

		subscribeToDevices(PARTICIPANT.PERMISSIONS.MAX_DEFAULT, inCallOptions)
		// As done by the media settings dialog opened during a call.
		subscribeToDevices(PARTICIPANT.PERMISSIONS.MAX_DEFAULT)
		await vi.waitFor(() => expect(grabbedMedia()).toEqual(expect.arrayContaining(['audio'])))

		mediaDevicesManager.getUserMedia.mockClear()
		unsubscribeFromDevices(PARTICIPANT.PERMISSIONS.MAX_DEFAULT)

		// The in-call subscriber is still there, but it does not need a preview,
		// so the microphone must not be grabbed again for it.
		subscribeToDevices(PARTICIPANT.PERMISSIONS.MAX_DEFAULT, inCallOptions)
		await vi.waitFor(() => expect(mediaDevicesManager.isSupported).toHaveBeenCalled())
		expect(grabbedMedia()).toEqual([])
	})
})
