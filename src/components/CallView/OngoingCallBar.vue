<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import NcButton from '@nextcloud/vue/components/NcButton'
import IconPhone from 'vue-material-design-icons/Phone.vue'
import IconPhoneHangup from 'vue-material-design-icons/PhoneHangup.vue'
import { useActorStore } from '../../stores/actor.ts'
import { useTokenStore } from '../../stores/token.ts'

const store = useStore()
const router = useRouter()
const tokenStore = useTokenStore()
const actorStore = useActorStore()

/**
 * The call is held in another conversation than the one being looked at. There
 * is no call view to show it, so this bar is the only thing telling the user
 * that they are still in a call - and the only way out of it from here.
 */
const callToken = computed(() => tokenStore.activeCallToken)
const isVisible = computed(() => !!callToken.value && callToken.value !== tokenStore.token)
const callConversationName = computed(() => store.getters.conversation(callToken.value)?.displayName ?? '')

/**
 * Go back to the conversation the call is in.
 */
function returnToCall() {
	router.push({ name: 'conversation', params: { token: callToken.value } })
}

/**
 * Leave the call without having to go back to its conversation first.
 */
function leaveCall() {
	store.dispatch('leaveCall', {
		token: callToken.value,
		participantIdentifier: actorStore.participantIdentifier,
	})
}
</script>

<template>
	<div v-if="isVisible" class="ongoing-call-bar">
		<IconPhone :size="20" />
		<span class="ongoing-call-bar__label">
			{{ t('spreed', 'You are still in the call in {conversation}', { conversation: callConversationName }) }}
		</span>
		<NcButton variant="secondary" @click="returnToCall">
			{{ t('spreed', 'Return to call') }}
		</NcButton>
		<NcButton variant="error" @click="leaveCall">
			<template #icon>
				<IconPhoneHangup :size="20" />
			</template>
			{{ t('spreed', 'Leave call') }}
		</NcButton>
	</div>
</template>

<style lang="scss" scoped>
.ongoing-call-bar {
	display: flex;
	align-items: center;
	gap: calc(var(--default-grid-baseline) * 2);
	padding: calc(var(--default-grid-baseline) * 2);
	border-block-end: 1px solid var(--color-border);
	background-color: var(--color-primary-element-light);

	&__label {
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}
</style>
