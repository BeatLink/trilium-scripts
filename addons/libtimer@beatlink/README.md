# Timer

Reusable Preact countdown timer component for TriliumNext widget UIs — hour/minute/second
dropdowns before it's started, a live countdown display once running, and start/pause/reset
controls. Ships 3 default sound-effect files (select/start/end), each served via a
`customResourceProvider` label so the component can play them without any extra setup, and each
overridable via a prop if a consumer wants its own sounds.

## Usage

Install as a dependency and clone the `Timer.jsx` note (and its 3 bundled `.wav` children) as a
child of the JSX widget that needs it:

```jsx
import { Timer } from "Timer.jsx"

<Timer
    initialHours={0}
    initialMinutes={5}
    initialSeconds={0}
    initialEnableSounds={true}
/>
```

## Props

| Prop                  | Type    | Default                          | Description                                  |
|-----------------------|---------|-----------------------------------|-----------------------------------------------|
| `initialHours`        | number  | `0`                                | Starting hours, shown while the timer is idle |
| `initialMinutes`      | number  | `0`                                | Starting minutes                              |
| `initialSeconds`      | number  | `0`                                | Starting seconds                              |
| `initialEnableSounds` | boolean | `false`                            | Whether to play sound effects                 |
| `selectSoundUrl`      | string  | `custom/libtimerSelect.wav`        | Played when a dropdown value changes          |
| `startSoundUrl`       | string  | `custom/libtimerStart.wav`         | Played when the timer starts                  |
| `endSoundUrl`         | string  | `custom/libtimerEnd.wav`           | Played when the timer expires or is reset     |

To use your own sounds instead of the bundled defaults, pass `selectSoundUrl`/`startSoundUrl`/
`endSoundUrl` pointing at your own `customResourceProvider`-labeled note (see
[`cinnamon-applet-inbox@beatlink`](../cinnamon-applet-inbox@beatlink/) for an example of a
`customResourceProvider` label on a static resource note).
