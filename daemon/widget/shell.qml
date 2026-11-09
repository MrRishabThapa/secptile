// Secptile desktop widget: Braille art pinned above the wallpaper and below your
// windows. Follows the assistant's live status: asleep, awake, thinking, talking,
// and "mega evolve". Clicks pass straight through to the desktop.
//
// Frames come from build_frames.py. Run with: qs -p ~/.secptile/widget
import QtQuick
import Quickshell
import Quickshell.Wayland
import "frames.js" as Frames

ShellRoot {
  id: root

  readonly property string statusUrl:
    Quickshell.env("SECPTILE_WIDGET_STATUS_URL") || "http://localhost:3100/api/assistant/status"
  // Each Braille dot is drawn as a square: font glyphs get colour fringes and
  // uneven rows at this size. At a 1.25 display scale these are exactly 3 and 2
  // physical pixels. Raise or lower both together to resize the widget.
  readonly property real dotPitch: 2.4
  readonly property real dotSize: 1.6
  readonly property int staleAfterMs: 20000
  readonly property int glanceMinTicks: 18
  readonly property int glanceRangeTicks: 40

  // "mono.talk1" etc. Set SECPTILE_WIDGET_PREVIEW to hold one frame on top of
  // everything, to review how it renders. SECPTILE_WIDGET_ON_TOP shows it above
  // your windows while testing.
  readonly property bool onTop: Boolean(Quickshell.env("SECPTILE_WIDGET_ON_TOP"))
  readonly property string preview: Quickshell.env("SECPTILE_WIDGET_PREVIEW") || ""

  property string mood: "sleep"     // sleep | awake | think | talk
  property bool mega: false
  property int evolveStep: -1       // >= 0 while the evolve animation plays
  property bool evolveReverse: false
  property int tick: 0
  property string pose: "sleep0"
  property int nextGlance: 20
  property int poseHold: 0
  property var frame: Frames.data.frames["mono.sleep0"]

  function showFrame() {
    if (preview) {
      frame = preview.startsWith("evolve")
        ? Frames.data.evolve[Number(preview.slice(6))]
        : Frames.data.frames[preview]
      return
    }
    if (evolveStep >= 0) {
      frame = Frames.data.evolve[evolveStep]
      return
    }
    frame = Frames.data.frames[(mega ? "mega." : "mono.") + pose]
  }

  function pickPose() {
    if (mood === "sleep") {
      pose = "sleep" + (Math.floor(tick / 7) % 3)
    } else if (mood === "think") {
      pose = "think" + (Math.floor(tick / 3) % 3)
    } else if (mood === "talk") {
      pose = "talk" + (Math.floor(tick / 2) % 4)
    } else if (poseHold > 0) {
      poseHold -= 1
    } else {
      pose = "idle"
      if (tick >= nextGlance) {
        // Looks around now and then, so it never sits frozen.
        const choices = ["blink", "blink", "left", "right", "happy"]
        pose = choices[Math.floor(Math.random() * choices.length)]
        poseHold = pose === "blink" ? 1 : 6
        nextGlance = tick + glanceMinTicks + Math.floor(Math.random() * glanceRangeTicks)
      }
    }
  }

  function setMood(next) {
    if (next === mood) return
    const waking = mood === "sleep" && next !== "sleep"
    mood = next
    if (waking && next === "awake") {
      // Startled awake, then settled.
      pose = "wide"
      poseHold = 8
    }
  }

  function setMega(next) {
    if (next === mega && evolveStep < 0) return
    if (next === mega) return
    mega = next
    evolveReverse = !next
    evolveStep = next ? 0 : Frames.data.evolve.length - 1
  }

  function applyStatus(payload) {
    const status = payload.status
    const fresh = status && (Date.now() - Date.parse(status.at) < staleAfterMs)
    const state = fresh ? status.state : "stopped"
    if (state === "speaking") setMood("talk")
    else if (state === "transcribing") setMood("think")
    else if (state === "conversing" || state === "sent" || state === "error") setMood("awake")
    else setMood("sleep") // listening, sleeping, muted, stopped: waiting for "secptile"
    setMega(payload.effort === "high")
  }

  function poll() {
    const request = new XMLHttpRequest()
    request.onreadystatechange = function () {
      if (request.readyState !== XMLHttpRequest.DONE) return
      if (request.status === 200) {
        try {
          applyStatus(JSON.parse(request.responseText))
          return
        } catch (error) {
          console.warn("bad status:", error)
        }
      }
      setMood("sleep") // app offline
    }
    request.open("GET", statusUrl)
    request.send()
  }

  Timer {
    interval: 500
    running: !root.preview
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

  Timer {
    interval: 110
    running: !root.preview
    repeat: true
    onTriggered: {
      root.tick += 1
      if (root.evolveStep >= 0) {
        root.evolveStep += root.evolveReverse ? -1 : 1
        if (root.evolveStep >= Frames.data.evolve.length || root.evolveStep < 0) root.evolveStep = -1
      } else {
        root.pickPose()
      }
      root.showFrame()
    }
  }

  Component.onCompleted: showFrame()

  PanelWindow {
    id: panel

    anchors { bottom: true; right: true }
    margins { bottom: 12; right: 20 }
    implicitWidth: Math.ceil(Frames.data.columns * 2 * root.dotPitch)
    implicitHeight: Math.ceil(Frames.data.rows * 4 * root.dotPitch)
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "secptile-widget"
    WlrLayershell.layer: root.preview || root.onTop ? WlrLayer.Overlay : WlrLayer.Bottom
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    mask: Region {} // clicks pass through

    Canvas {
      id: art
      anchors.fill: parent
      opacity: root.mood === "sleep" && !root.mega ? 0.7 : 1
      Behavior on opacity { NumberAnimation { duration: 400 } }

      // Braille dot bits, in the Unicode order.
      readonly property var bits: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]]

      Connections {
        target: root
        function onFrameChanged() { art.requestPaint() }
      }

      onPaint: {
        const ctx = getContext("2d")
        ctx.clearRect(0, 0, width, height)
        const frame = root.frame
        if (!frame) return
        const palette = Frames.data.palette
        const pitch = root.dotPitch
        const size = root.dotSize
        let current = ""
        for (let row = 0; row < frame.rows.length; row++) {
          const text = frame.rows[row]
          const colors = frame.colors ? frame.colors[row] : null
          for (let col = 0; col < text.length; col++) {
            const pattern = text.charCodeAt(col) - 0x2800
            if (pattern <= 0) continue
            const fill = colors ? palette[colors[col]] : Frames.data.grey
            if (fill !== current) {
              ctx.fillStyle = fill
              current = fill
            }
            for (let bit = 0; bit < 8; bit++) {
              if (pattern & (1 << bit)) {
                ctx.fillRect((col * 2 + bits[bit][0]) * pitch, (row * 4 + bits[bit][1]) * pitch, size, size)
              }
            }
          }
        }
      }
    }
  }
}
