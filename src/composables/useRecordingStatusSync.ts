/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { showError } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { onBeforeUnmount } from 'vue'
import { useStore } from 'vuex'
import { CALL, PARTICIPANT, SIGNALING } from '../constants.ts'
import { getTalkConfig } from '../services/CapabilitiesManager.ts'
import { EventBus } from '../services/EventBus.ts'

/**
 * Composable for registering and cleaning up global EventBus listeners
 */
export function useRecordingStatusSync() {
	const vuexStore = useStore()

	if (getTalkConfig('local', 'signaling', 'mode') !== SIGNALING.MODE.INTERNAL) {
		EventBus.on('signaling-recording-status-changed', handleSignalingRecordingStatusChanged)
	}

	onBeforeUnmount(() => {
		EventBus.off('signaling-recording-status-changed', handleSignalingRecordingStatusChanged)
	})

	/**
	 * Handle signaling 'processRoomMessageEvent -> recording' event for status change
	 *
	 * @param payload
	 * @param payload."0" - conversation token
	 * @param payload."1" - recording status
	 */
	function handleSignalingRecordingStatusChanged([token, status]: [string, number]) {
		vuexStore.dispatch('setConversationProperties', { token, properties: { callRecording: status } })

		if (status !== CALL.RECORDING.FAILED) {
			return
		}

		// The failure concerns the conversation the recording was running in,
		// which is not necessarily the one being looked at while a call is
		// ongoing elsewhere.
		if (!vuexStore.getters.isInCall(token)) {
			return
		}

		const conversation = vuexStore.getters.conversation(token)
		if (conversation?.participantType === PARTICIPANT.TYPE.OWNER
			|| conversation?.participantType === PARTICIPANT.TYPE.MODERATOR) {
			showError(t('spreed', 'The recording failed. Please contact your administrator.'))
		}
	}
}
