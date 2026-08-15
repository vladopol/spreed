/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Temporary debug helper for https://github.com/nextcloud/talk-desktop/issues/1777
// Buffers [ISSUE-1777] log entries to localStorage so they survive even if
// DevTools wasn't open at the moment the bug fired. Remove once diagnosed.
//
// When a call is started suspiciously soon after entering a room, the buffer is
// uploaded to the DAV *uploads* staging area (data/<uid>/uploads/, NOT the user's
// files) so it can be collected server-side. That area produces no activity
// entries, is invisible in the Files UI and is not picked up by sync clients —
// the collection must stay silent for the user. The trade-off is that the
// server sweeps it: UploadCleanup runs daily and drops folders once everything
// in them is older than cache_chunk_gc_ttl (24 h by default), so collect within
// a day of the incident.

import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { generateRemoteUrl } from '@nextcloud/router'

type Issue1777LogEntry = {
	ts: string
	win: string
	event: string
	data?: unknown
	stack?: string
}

/** Just the parts of a vue-router route this helper reads */
type RouteLike = {
	fullPath?: string
	hash?: string
}

const STORAGE_KEY = '__issue1777_debug_log'
const MAX_ENTRIES = 300

// Origin events (an incoming call accepted, the #direct-call hash set) can be
// tens of minutes and hundreds of navigations before the call fires, so they get
// their own ring that routine noise cannot evict.
const ORIGIN_STORAGE_KEY = '__issue1777_origin_log'
const MAX_ORIGIN_ENTRIES = 40

const CONTEXT_STORAGE_KEY = '__issue1777_context'

// talk-desktop renders the main window and the callbox in separate renderers
// that share one localStorage, so entries interleave. Tag each with its window.
const WINDOW_ID = Math.random().toString(36).slice(2, 8)

/** Join room → join call faster than this looks like the bug (or an accepted incoming call) */
const SUSPICIOUS_JOIN_DELAY_MS = 1500
/** Never upload more often than this, however many events fire */
const UPLOAD_COOLDOWN_MS = 10000

let lastJoinedRoom: { token: string, at: number } | null = null
let lastUploadAt = 0

/**
 * Read a persisted ring buffer, tolerating corrupted storage.
 *
 * @param key storage key to read
 */
function readBuffer(key = STORAGE_KEY): Issue1777LogEntry[] {
	try {
		return JSON.parse(localStorage.getItem(key) || '[]') as Issue1777LogEntry[]
	} catch {
		return []
	}
}

/**
 * Append an entry to one of the rings.
 *
 * @param key storage key to write
 * @param entry entry to append
 * @param limit how many entries the ring keeps
 */
function pushToRing(key: string, entry: Issue1777LogEntry, limit: number) {
	const buffer = readBuffer(key)
	buffer.push(entry)
	while (buffer.length > limit) {
		buffer.shift()
	}

	try {
		localStorage.setItem(key, JSON.stringify(buffer))
	} catch {
		// storage full or unavailable, drop silently
	}
}

/**
 * Read the context (signaling session id and friends) shared across windows.
 */
function readContext(): Record<string, unknown> {
	try {
		return JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY) || '{}') as Record<string, unknown>
	} catch {
		return {}
	}
}

/**
 * Record context that makes client entries joinable with the server logs.
 *
 * The signaling session id is the key one: it is what the HPB prints in its
 * `joined room` / `joined call` lines, so it beats correlating by wall clock.
 *
 * @param patch fields to merge into the stored context
 */
export function setIssue1777Context(patch: Record<string, unknown>) {
	try {
		localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ ...readContext(), ...patch, updatedAt: new Date().toISOString() }))
	} catch {
		// storage full or unavailable, drop silently
	}
}

/**
 * Upload the current buffer to the DAV uploads staging area.
 *
 * Fire-and-forget: never throws and never blocks the call path it is observing.
 *
 * @param reason what triggered the upload, stored alongside the buffer
 */
function uploadBuffer(reason: string) {
	const user = getCurrentUser()
	if (!user?.uid) {
		return
	}

	const now = Date.now()
	if (now - lastUploadAt < UPLOAD_COOLDOWN_MS) {
		return
	}
	lastUploadAt = now

	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const folder = generateRemoteUrl(`dav/uploads/${user.uid}/issue1777-${stamp}`)
	const payload = {
		reason,
		uid: user.uid,
		window: WINDOW_ID,
		userAgent: navigator.userAgent,
		uploadedAt: new Date().toISOString(),
		context: readContext(),
		origin: readBuffer(ORIGIN_STORAGE_KEY),
		entries: readBuffer(),
	}

	// MKCOL the folder first: UploadCleanup logs an error for loose files in the
	// uploads root, and only folders get a cleanup job registered.
	axios.request({ method: 'MKCOL', url: folder })
		.then(() => axios.put(`${folder}/log.json`, JSON.stringify(payload, null, '\t'), {
			headers: { 'Content-Type': 'application/json' },
		}))
		.then(() => console.debug('[ISSUE-1777] buffer uploaded', reason))
		.catch((error) => console.debug('[ISSUE-1777] buffer upload failed, keeping it locally', error))
}

/**
 * Watch the event stream for "call started right after entering a room".
 *
 * This deliberately also matches accepted incoming calls — they are sub-second
 * too — because those are the control samples for the same condition.
 *
 * @param event event name being logged
 * @param data event payload
 */
function maybeUploadOnSuspiciousJoin(event: string, data?: unknown) {
	const token = (data as { token?: string })?.token
	if (!token) {
		return
	}

	if (event === 'signaling.joinRoom') {
		lastJoinedRoom = { token, at: Date.now() }
		return
	}

	if (!event.startsWith('signaling.joinCall success')) {
		return
	}

	if (lastJoinedRoom?.token === token && Date.now() - lastJoinedRoom.at < SUSPICIOUS_JOIN_DELAY_MS) {
		uploadBuffer(`joinCall ${Date.now() - lastJoinedRoom.at}ms after joinRoom ${token}`)
	}
}

/**
 * Record one diagnostic event.
 *
 * @param event short event name
 * @param data event payload
 * @param captureStack whether to attach a stack trace (use on decision points)
 */
export function logIssue1777(event: string, data?: unknown, captureStack = false) {
	const entry: Issue1777LogEntry = { ts: new Date().toISOString(), win: WINDOW_ID, event, data }

	console.debug('[ISSUE-1777]', event, data)
	if (captureStack) {
		entry.stack = new Error('stack capture').stack
		console.trace('[ISSUE-1777]', event)
	}

	pushToRing(STORAGE_KEY, entry, MAX_ENTRIES)

	try {
		maybeUploadOnSuspiciousJoin(event, data)
	} catch {
		// diagnostics must never break the code they observe
	}
}

/**
 * Record an event that starts a suspected chain, keeping it out of eviction.
 *
 * Use for the things that may precede the auto-call by a long time: an incoming
 * call being accepted, the '#direct-call' hash being set.
 *
 * @param event short event name
 * @param data event payload
 * @param captureStack whether to attach a stack trace
 */
export function logIssue1777Origin(event: string, data?: unknown, captureStack = false) {
	logIssue1777(event, data, captureStack)
	pushToRing(ORIGIN_STORAGE_KEY, {
		ts: new Date().toISOString(),
		win: WINDOW_ID,
		event,
		data,
	}, MAX_ORIGIN_ENTRIES)
}

/**
 * Log every router navigation, including how it was performed.
 *
 * The leading hypothesis is a '#direct-call' left behind in a history entry, so
 * the decisive detail is whether a return to the room was a fresh push or a walk
 * back through history (popstate) — the hash can only come back on the latter.
 *
 * @param router the Talk vue-router instance
 * @param router.afterEach hook registration used to observe every navigation
 */
export function instrumentRouterForIssue1777(router: {
	afterEach: (hook: (to: RouteLike, from: RouteLike) => void) => void
}) {
	let lastNavigationWasPop = false

	if (typeof window !== 'undefined') {
		window.addEventListener('popstate', (event) => {
			lastNavigationWasPop = true
			logIssue1777('router popstate (history walk)', {
				state: event.state,
				location: window.location.href,
			})
		})
	}

	router.afterEach((to, from) => {
		logIssue1777('router navigation', {
			from: from?.fullPath,
			to: to?.fullPath,
			toHash: to?.hash,
			fromHash: from?.hash,
			viaPopstate: lastNavigationWasPop,
			historyState: typeof window !== 'undefined' ? window.history.state : undefined,
		}, Boolean(to?.hash))
		lastNavigationWasPop = false
	})
}

/**
 * Return the buffered entries, for manual inspection from DevTools.
 */
export function dumpIssue1777Log(): Issue1777LogEntry[] {
	return readBuffer()
}

/**
 * Drop the buffered entries.
 */
export function clearIssue1777Log() {
	localStorage.removeItem(STORAGE_KEY)
}

declare global {
	interface Window {
		__issue1777?: {
			dump: typeof dumpIssue1777Log
			dumpOrigin: () => Issue1777LogEntry[]
			context: () => Record<string, unknown>
			clear: typeof clearIssue1777Log
			upload: (reason?: string) => void
		}
	}
}

if (typeof window !== 'undefined') {
	window.__issue1777 = {
		dump: dumpIssue1777Log,
		dumpOrigin: () => readBuffer(ORIGIN_STORAGE_KEY),
		context: readContext,
		clear: clearIssue1777Log,
		upload: (reason = 'manual') => {
			lastUploadAt = 0
			uploadBuffer(reason)
		},
	}
}
