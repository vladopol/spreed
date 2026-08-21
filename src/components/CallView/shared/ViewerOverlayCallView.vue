<!--
  - SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div ref="ghost" class="viewer-overlay-ghost">
		<Teleport to="body">
			<!-- Add .app-talk to use Talk icon classes outside of #content-vue -->
			<div
				class="viewer-overlay app-talk"
				:class="{ 'viewer-overlay--above-chat-input': isAboveChatInput }"
				:style="computedStyle">
				<div
					class="viewer-overlay__collapse"
					:class="{ collapsed: isCollapsed }">
					<NcButton
						variant="secondary"
						class="viewer-overlay__button"
						:aria-label="
							isCollapsed ? t('spreed', 'Collapse') : t('spreed', 'Expand')
						"
						@click.stop="isCollapsed = !isCollapsed">
						<template #icon>
							<ChevronDown v-if="!isCollapsed" :size="20" />
							<ChevronUp v-else :size="20" />
						</template>
					</NcButton>
				</div>

				<TransitionWrapper name="slide-down">
					<div
						v-show="!isCollapsed"
						class="viewer-overlay__video-container"
						tabindex="0"
						@click="maximize">
						<div class="video-overlay__top-bar">
							<NcButton
								variant="secondary"
								class="viewer-overlay__button"
								:aria-label="t('spreed', 'Expand')"
								@click.stop="maximize">
								<template #icon>
									<ArrowExpand :size="20" />
								</template>
							</NcButton>
						</div>

						<!-- local screen -->
						<ScreenShare
							v-if="showLocalScreen"
							:token="token"
							:localMediaModel="localModel"
							:sharedData="localSharedData" />
						<!-- remote screen -->
						<ScreenShare
							v-else-if="model && screens[model.attributes.peerId]"
							:token="token"
							:callParticipantModel="model"
							:sharedData="sharedData" />

						<VideoVue
							v-else-if="model"
							class="viewer-overlay__video"
							:token="token"
							:model="model"
							:sharedData="sharedData"
							isGrid
							unSelectable
							hideBottomBar
							@clickVideo="maximize">
							<template #bottomBar />
						</VideoVue>

						<EmptyCallView v-else isSmall />

						<LocalVideo
							v-if="localModel.attributes.videoEnabled"
							class="viewer-overlay__local-video"
							:token="token"
							:localMediaModel="localModel"
							:localCallParticipantModel="localCallParticipantModel"
							isSmall
							unSelectable />

						<div class="viewer-overlay__bottom-bar">
							<LocalAudioControlButton
								class="viewer-overlay__button"
								:token="token"
								:conversation="conversation"
								:model="localModel"
								variant="secondary"
								disableKeyboardShortcuts />
							<LocalVideoControlButton
								class="viewer-overlay__button"
								:token="token"
								:conversation="conversation"
								:model="localModel"
								variant="secondary"
								disableKeyboardShortcuts />
							<!-- While another conversation is browsed, this overlay is
								the only call UI on screen: without it the call could
								not be ended without navigating back -->
							<NcButton
								v-if="isCallInAnotherConversation"
								class="viewer-overlay__button"
								variant="error"
								:aria-label="t('spreed', 'Leave call')"
								:title="t('spreed', 'Leave call')"
								@click.stop="leaveCall">
								<template #icon>
									<IconPhoneHangup :size="20" />
								</template>
							</NcButton>
						</div>
					</div>
				</TransitionWrapper>
			</div>
		</Teleport>
	</div>
</template>

<script>
import { isRTL, t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import ArrowExpand from 'vue-material-design-icons/ArrowExpand.vue'
import ChevronDown from 'vue-material-design-icons/ChevronDown.vue'
import ChevronUp from 'vue-material-design-icons/ChevronUp.vue'
import IconPhoneHangup from 'vue-material-design-icons/PhoneHangup.vue'
import TransitionWrapper from '../../UIShared/TransitionWrapper.vue'
import EmptyCallView from './EmptyCallView.vue'
import LocalAudioControlButton from './LocalAudioControlButton.vue'
import LocalVideo from './LocalVideo.vue'
import LocalVideoControlButton from './LocalVideoControlButton.vue'
import ScreenShare from './ScreenShare.vue'
import VideoVue from './VideoVue.vue'
import { useActorStore } from '../../../stores/actor.ts'
import { useCallViewStore } from '../../../stores/callView.ts'
import { useTokenStore } from '../../../stores/token.ts'
import { localCallParticipantModel, localMediaModel } from '../../../utils/webrtc/index.js'

export default {
	name: 'ViewerOverlayCallView',

	components: {
		EmptyCallView,
		LocalAudioControlButton,
		LocalVideoControlButton,
		ScreenShare,
		LocalVideo,
		ChevronUp,
		ChevronDown,
		IconPhoneHangup,
		NcButton,
		TransitionWrapper,
		VideoVue,
		ArrowExpand,
	},

	props: {
		token: {
			type: String,
			required: true,
		},

		// Promoted participant model
		model: {
			type: Object,
			required: false,
			default: null,
		},

		sharedData: {
			type: Object,
			required: false,
			default: null,
		},

		localModel: {
			type: Object,
			required: false,
			default: () => localMediaModel,
		},

		localCallParticipantModel: {
			type: Object,
			required: false,
			default: () => localCallParticipantModel,
		},

		localSharedData: {
			type: Object,
			required: true,
			default: () => {},
		},

		screens: {
			type: Array,
			required: false,
			default: () => [],
		},
	},

	setup() {
		return {
			actorStore: useActorStore(),
			callViewStore: useCallViewStore(),
			tokenStore: useTokenStore(),
		}
	},

	data() {
		return {
			isCollapsed: false,
			observer: null,
			// The message area the overlay is placed above while another
			// conversation is browsed, if any. Kept only to stop observing it
			// once it is gone.
			observedChatMessagesArea: null,
			isAboveChatInput: false,
			position: {
				right: 0,
				left: 0,
				bottom: 0,
			},
		}
	},

	computed: {
		conversation() {
			return this.$store.getters.conversation(this.token)
		},

		hasLocalScreen() {
			return !!this.localModel.attributes.localScreen
		},

		showLocalScreen() {
			return this.hasLocalScreen && this.screens[0] === localCallParticipantModel.attributes.peerId
		},

		computedStyle() {
			return {
				[isRTL() ? 'left' : 'right']: this.position[isRTL() ? 'left' : 'right'] + 'px',
				bottom: this.position.bottom + 'px',
			}
		},

		/**
		 * The call is overlaid on a different conversation than its own, so no
		 * other call controls are on screen.
		 *
		 * @return {boolean}
		 */
		isCallInAnotherConversation() {
			return this.token !== this.tokenStore.token
		},
	},

	watch: {
		'tokenStore.token': function() {
			// Another conversation is browsed now, so the chat the overlay is
			// placed above may be a different element.
			this.$nextTick(this.observeChatMessagesArea)
		},
	},

	mounted() {
		this.observer = new ResizeObserver(this.updatePosition)
		this.observer.observe(this.$refs.ghost)
		this.observeChatMessagesArea()
	},

	beforeUnmount() {
		this.observer.disconnect()
	},

	methods: {
		t,
		maximize() {
			if (OCA.Viewer) {
				OCA.Viewer.close()
			}
			this.callViewStore.setIsViewerOverlay(false)

			if (this.isCallInAnotherConversation) {
				// The call is overlaid on another conversation being browsed;
				// going back to it is what maximising means here.
				this.$router.push({ name: 'conversation', params: { token: this.token } })
			}
		},

		async leaveCall() {
			this.callViewStore.setSelectedVideoPeerId(null)
			await this.$store.dispatch('leaveCall', {
				token: this.token,
				participantIdentifier: this.actorStore.participantIdentifier,
			})
		},

		/**
		 * The messages of the browsed conversation, that is everything of its
		 * chat above the message input.
		 *
		 * The overlay is anchored to the bottom of the call container, which
		 * while another conversation is browsed spans the whole chat: the
		 * overlay would cover the message input and its send button. It is
		 * placed above the messages instead, which also makes it follow the
		 * input as that one grows with the message being written.
		 *
		 * @return {HTMLElement|null} the element to place the overlay above, or
		 *         null when the overlay is used over the viewer as upstream does
		 */
		getChatMessagesArea() {
			if (!this.isCallInAnotherConversation) {
				return null
			}

			return this.$refs.ghost?.closest('.main-view')?.querySelector('.messages-list-dragover-wrapper') ?? null
		},

		observeChatMessagesArea() {
			const chatMessagesArea = this.getChatMessagesArea()

			if (chatMessagesArea !== this.observedChatMessagesArea) {
				if (this.observedChatMessagesArea) {
					this.observer.unobserve(this.observedChatMessagesArea)
				}
				// The messages shrink when the message input grows, so
				// observing them is what keeps the overlay above the input.
				if (chatMessagesArea) {
					this.observer.observe(chatMessagesArea)
				}
				this.observedChatMessagesArea = chatMessagesArea
			}

			this.updatePosition()
		},

		updatePosition() {
			const { left, right, bottom } = this.$refs.ghost.getBoundingClientRect()
			if (isRTL()) {
				this.position.left = left
			} else {
				this.position.right = window.innerWidth - right
			}

			const chatMessagesArea = this.getChatMessagesArea()
			this.isAboveChatInput = Boolean(chatMessagesArea)
			this.position.bottom = window.innerHeight - (chatMessagesArea?.getBoundingClientRect().bottom ?? bottom)
		},
	},
}
</script>

<style lang="scss" scoped>
.viewer-overlay-ghost {
	position: absolute;
	bottom: 8px;
	inset-inline: 0 8px;
}

.viewer-overlay {
	--aspect-ratio: calc(3 / 4);
	--width: 20vw;
	--min-width: 250px;
	--max-width: 400px;
	position: absolute;
	width: var(--width);
	min-width: var(--min-width);
	max-width: var(--max-width);
	min-height: calc(var(--default-clickable-area) + 8px);
	z-index: 11000;
}

// Placed above the messages of the browsed conversation, which end right above
// the "scroll to bottom" button: leave room for that button as well, as it is
// anchored on top of the message input and would otherwise be covered.
.viewer-overlay--above-chat-input {
	margin-bottom: calc(var(--default-clickable-area) + 8px);
}

.viewer-overlay * {
	box-sizing: border-box;
}

.viewer-overlay__collapse {
	position: absolute;
	top: 8px;
	inset-inline-end: 8px;
	z-index: 100;
}

.viewer-overlay__button {
	opacity: 0.8;
	&:active,
	&:hover,
	&:focus {
		opacity: 0.9;
	}
}

.video-overlay__top-bar {
	position: absolute;
	top: 8px;
	inset-inline-start: 8px;
	z-index: 100;
}

.viewer-overlay__bottom-bar {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	position: absolute;
	bottom: 0;
	width: 100%;
	padding: 0 12px 8px 12px;
	z-index: 1;
}

.viewer-overlay__video-container {
	width: 100%;
	height: calc(var(--width) * var(--aspect-ratio));
	min-height: calc(var(--min-width) * var(--aspect-ratio));
	max-height: calc(var(--max-width) * var(--aspect-ratio));
	/* Note: because of transition it always has position absolute on animation */
	bottom: 0;
	inset-inline-end: 0;
}

.viewer-overlay__local-video {
	position: absolute;
	bottom: 8px;
	inset-inline-end: 8px;
	width: 25%;
	height: 25%;
	overflow: hidden;
}

.viewer-overlay__video {
	position: relative;
	height: 100%;
}

:deep(.screen) {
	border-radius: calc(var(--default-clickable-area) / 4);
}
</style>
