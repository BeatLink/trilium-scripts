import { RightPanelWidget, defineWidget, useEffect, useState } from "trilium:preact";

import { Timer } from "Timer.jsx"
import { getTimerSettings } from "Settings.jsx"

function TimerPanel() {
    const [settings, setSettings] = useState(null)

    useEffect(() => {
        (async () => setSettings(await getTimerSettings()))()
    }, [])

    if (!settings) return null

    return (
        <RightPanelWidget id="x-timer" title="Timer">
            <div className="timerControls">
                <Timer initialEnableSounds={settings.enableSounds} />
            </div>
        </RightPanelWidget>
    )
}

export default defineWidget({
    parent: "right-pane",
    position: 6,
    render: TimerPanel
});
