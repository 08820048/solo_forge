"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

type FlipClockCountdownProps = {
  target: string | null
  className?: string
  scale?: number
  mode?: "inline" | "full"
  showDays?: boolean
  showSeconds?: boolean
}

function clampNonNegativeInt(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function getRemainingSeconds(target: string | null) {
  if (!target) return null
  const ms = Date.parse(target)
  if (!Number.isFinite(ms)) return null
  const diff = ms - Date.now()
  return clampNonNegativeInt(diff / 1000)
}

function splitTime(totalSeconds: number) {
  const total = clampNonNegativeInt(totalSeconds)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return { days, hours, minutes, seconds }
}

function pad2(n: number) {
  return String(Math.max(0, n)).padStart(2, "0")
}

function computeBaseSize({
  showDays,
  showSeconds,
}: {
  showDays: boolean
  showSeconds: boolean
}) {
  const digitW = 96
  const digitH = 120
  const dividerW = 68

  const blocks: Array<"days" | "hours" | "minutes" | "seconds"> = []
  if (showDays) blocks.push("days")
  blocks.push("hours", "minutes")
  if (showSeconds) blocks.push("seconds")

  const digits = blocks.reduce((sum, b) => sum + (b === "days" ? 2 : 2), 0)
  const dividers = showDays ? blocks.length : Math.max(0, blocks.length - 1)

  return {
    width: digits * digitW + dividers * dividerW,
    height: digitH,
  }
}

type DigitState = {
  current: string
  previous: string
  playUntilMs: number
  flipId: number
}

type ClockState = {
  nowMs: number
  days: DigitState[]
  hours: DigitState[]
  minutes: DigitState[]
  seconds: DigitState[]
}

function buildDigitStateFromDigits(digits: string[]) {
  return digits.map((d) => ({ current: d, previous: d, playUntilMs: 0, flipId: 0 }))
}

function mergeDigits(prev: DigitState[] | undefined, nextDigits: string[], nowMs: number) {
  return nextDigits.map((nextDigit, idx) => {
    const existing = prev?.[idx]
    if (!existing) return { current: nextDigit, previous: nextDigit, playUntilMs: 0, flipId: 0 }
    if (existing.current === nextDigit) return existing
    return { current: nextDigit, previous: existing.current, playUntilMs: nowMs + 800, flipId: existing.flipId + 1 }
  })
}

function Divider({ unit, label }: { unit: "days" | "hours" | "minutes" | "seconds"; label: string }) {
  return (
    <span className={cn("flip-clock-divider", unit)}>
      <span className="flip-clock-label">{label}</span>
    </span>
  )
}

function FlipDigit({ value, nowMs }: { value: DigitState; nowMs: number }) {
  const playing = value.playUntilMs > nowMs

  return (
    <ul key={value.flipId} className={cn("flip", playing && "play")}>
      <li className="flip-clock-before">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-hidden="true"
        >
          <div className="up">
            <div className="shadow" />
            <div className="inn">{value.previous}</div>
          </div>
          <div className="down">
            <div className="shadow" />
            <div className="inn">{value.previous}</div>
          </div>
        </a>
      </li>
      <li className="flip-clock-active">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-hidden="true"
        >
          <div className="up">
            <div className="shadow" />
            <div className="inn">{value.current}</div>
          </div>
          <div className="down">
            <div className="shadow" />
            <div className="inn">{value.current}</div>
          </div>
        </a>
      </li>
    </ul>
  )
}

export default function FlipClockCountdown({
  target,
  className,
  scale = 1,
  mode = "inline",
  showDays = true,
  showSeconds = true,
}: FlipClockCountdownProps) {
  const [clock, setClock] = useState<ClockState | null>(null)

  useEffect(() => {
    const update = () => {
      const remainingSeconds = getRemainingSeconds(target)
      if (remainingSeconds === null || !target) {
        setClock(null)
        return
      }

      const nowMs = Date.now()
      const { days, hours, minutes, seconds } = splitTime(remainingSeconds)
      const nextDays = pad2(days).split("")
      const nextHours = pad2(hours).split("")
      const nextMinutes = pad2(minutes).split("")
      const nextSeconds = pad2(seconds).split("")

      setClock((prev) => {
        if (!prev) {
          return {
            nowMs,
            days: buildDigitStateFromDigits(nextDays),
            hours: buildDigitStateFromDigits(nextHours),
            minutes: buildDigitStateFromDigits(nextMinutes),
            seconds: buildDigitStateFromDigits(nextSeconds),
          }
        }

        return {
          nowMs,
          days: mergeDigits(prev.days, nextDays, nowMs),
          hours: mergeDigits(prev.hours, nextHours, nowMs),
          minutes: mergeDigits(prev.minutes, nextMinutes, nowMs),
          seconds: mergeDigits(prev.seconds, nextSeconds, nowMs),
        }
      })
    }

    const timeoutId = window.setTimeout(update, 0)
    const intervalId = window.setInterval(update, 250)
    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [showDays, showSeconds, target])

  if (!target || !clock) return null

  const base = computeBaseSize({ showDays, showSeconds })

  return (
    <div
      className={cn("sf-flipclock", mode === "inline" && "sf-flipclock--inline", className)}
      style={{
        ["--sf-flipclock-scale" as never]: String(scale),
        ["--sf-flipclock-base-width" as never]: `${base.width}px`,
        ["--sf-flipclock-base-height" as never]: `${base.height}px`,
      }}
      aria-label={`倒计时 ${showDays ? `${Number(clock.days.map((d) => d.current).join(""))} 天 ` : ""}${clock.hours
        .map((d) => d.current)
        .join("")}:${clock.minutes.map((d) => d.current).join("")}${showSeconds ? `:${clock.seconds.map((d) => d.current).join("")}` : ""}`}
    >
      <div className="sf-flipclock__inner">
        <div className="flip-clock-wrapper">
          {showDays ? (
            <>
              <Divider unit="days" label="Days" />
              {clock.days.map((d, idx) => (
                <FlipDigit key={`d-${idx}`} value={d} nowMs={clock.nowMs} />
              ))}
              <Divider unit="hours" label="Hours" />
            </>
          ) : null}

          {clock.hours.map((d, idx) => (
            <FlipDigit key={`h-${idx}`} value={d} nowMs={clock.nowMs} />
          ))}

          <Divider unit="minutes" label="Minutes" />
          {clock.minutes.map((d, idx) => (
            <FlipDigit key={`m-${idx}`} value={d} nowMs={clock.nowMs} />
          ))}

          {showSeconds ? (
            <>
              <Divider unit="seconds" label="Seconds" />
              {clock.seconds.map((d, idx) => (
                <FlipDigit key={`s-${idx}`} value={d} nowMs={clock.nowMs} />
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
