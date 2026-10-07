package com.kubuno.chat.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The chat module serialises timestamps as RFC 3339 (chrono's DateTime<Utc>).
 * minSdk 26 gives us java.time, so no desugaring is needed.
 */
object Timestamps {

    private val timeOfDay = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())
    private val dayMonth = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
    private val fullDate = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault())
    private val shortDate = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.getDefault())

    fun parseMs(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching {
                // chrono may emit an offset other than Z ("+00:00").
                java.time.OffsetDateTime.parse(value).toInstant().toEpochMilli()
            }.getOrNull()
    }

    /** "14:05" — what a bubble shows. */
    fun clock(ms: Long): String =
        Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(timeOfDay)

    /**
     * What a conversation row shows on the right: the time today, "Hier"
     * yesterday, a short date beyond that.
     */
    fun rowStamp(ms: Long, nowMs: Long = System.currentTimeMillis()): String {
        if (ms <= 0) return ""
        val zone = ZoneId.systemDefault()
        val day = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return when {
            day == today -> clock(ms)
            day == today.minusDays(1) -> "Hier"
            day.isAfter(today.minusDays(7)) -> day.format(dayMonth)
            else -> day.format(shortDate)
        }
    }

    /** The centred separator pill between two days of messages. */
    fun datePill(ms: Long, nowMs: Long = System.currentTimeMillis()): String {
        val zone = ZoneId.systemDefault()
        val day = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return when (day) {
            today -> "Aujourd'hui"
            today.minusDays(1) -> "Hier"
            else -> day.format(fullDate)
        }
    }

    /** True when the two instants fall on different local days. */
    fun differentDay(aMs: Long, bMs: Long): Boolean = localDate(aMs) != localDate(bMs)

    private fun localDate(ms: Long): LocalDate =
        Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()
}
