import { ActionButton, FormDropdownList, useEffect, useState, useMemo } from "trilium:preact";

const hourOptions = Array.from({ length: 25 }, (_, i) => ({ key: i, name: `${i}h` }));
const minuteOptions = Array.from({ length: 60 }, (_, i) => ({ key: i, name: `${i}m` }));
const secondOptions = Array.from({ length: 60 }, (_, i) => ({ key: i, name: `${i}s` }));

export function Timer({
    initialHours = 0,
    initialMinutes = 0,
    initialSeconds = 0,
    initialEnableSounds = false,
    selectSoundUrl = "custom/libtimerSelect.wav",
    startSoundUrl = "custom/libtimerStart.wav",
    endSoundUrl = "custom/libtimerEnd.wav"
}){
    const [hours, setHours] = useState(initialHours);
    const [minutes, setMinutes] = useState(initialMinutes);
    const [seconds, setSeconds] = useState(initialSeconds);

    const [remainingSeconds, setRemainingSeconds] = useState(hours * 3600 + minutes * 60 + seconds);
    const [timerRunning, setTimerRunning] = useState(false);
    const [timerExpired, setTimerExpired] = useState(false);
    const [timerPaused, setTimerPaused] = useState(false);

    const [enableSounds, setEnableSounds] = useState(initialEnableSounds)
    const selectSound = useMemo(() => new Audio(selectSoundUrl), [selectSoundUrl]);
    const startSound = useMemo(() => new Audio(startSoundUrl), [startSoundUrl]);
    const endSound = useMemo(() => new Audio(endSoundUrl), [endSoundUrl]);
    useEffect(() => { selectSound.playbackRate = 0.8 }, [selectSound]);
    useEffect(() => { setEnableSounds(initialEnableSounds) }, [initialEnableSounds]);

    useEffect(() => {
        if (!timerRunning && !timerExpired  && !timerPaused) {
            setHours(initialHours ?? 0);
            setMinutes(initialMinutes ?? 0);
            setSeconds(initialSeconds ?? 0);
        }
    }, [initialHours, initialMinutes, initialSeconds, timerRunning, timerExpired, timerPaused]);

    useEffect(() => {
        if (!timerRunning && !timerExpired && !timerPaused) {
            const total = hours * 3600 + minutes * 60 + seconds;
            setRemainingSeconds(total);
        }
    }, [hours, minutes, seconds, timerRunning, timerExpired, timerPaused]);

    useEffect(() => {
        if (!timerRunning || timerPaused || remainingSeconds <= 0) return;
        const interval = setInterval(() => {
            setRemainingSeconds(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    setTimerRunning(false);
                    setTimerExpired(true);
                    enableSounds && endSound.play();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [timerRunning, timerPaused, remainingSeconds]);

    const displayHours = String(Math.floor(remainingSeconds / 3600)).padStart(2, "0");
    const displayMinutes = String(Math.floor((remainingSeconds % 3600) / 60)).padStart(2, "0");
    const displaySeconds = String(remainingSeconds % 60).padStart(2, "0");

    const timerUnset = remainingSeconds === 0;

    return (
        <div className="timer">
            {!timerRunning && !timerExpired && !timerPaused && (
                <>
                    <FormDropdownList
                        values={hourOptions}
                        currentValue={hours}
                        onChange={v => { setHours(Number(v)); enableSounds && selectSound.play(); }}
                        keyProperty="key"
                        titleProperty="name"
                        dropdownOptions={{ popperConfig: { placement: 'top' } }}
                    />
                    <FormDropdownList
                        values={minuteOptions}
                        currentValue={minutes}
                        onChange={v => { setMinutes(Number(v)); enableSounds && selectSound.play(); }}
                        keyProperty="key"
                        titleProperty="name"
                        dropdownOptions={{ popperConfig: { placement: 'top' } }}
                    />
                    <FormDropdownList
                        values={secondOptions}
                        currentValue={seconds}
                        onChange={v => { setSeconds(Number(v)); enableSounds && selectSound.play(); }}
                        keyProperty="key"
                        titleProperty="name"
                        dropdownOptions={{ popperConfig: { placement: 'top' } }}
                    />
                </>
            )}

            { (timerRunning || timerExpired || timerPaused) && (
                <span
                    className={[
                        timerRunning ? "running" : "",
                        timerRunning && !timerExpired ? "flash-accent" : "",
                        timerExpired ? "flash-red" : ""
                    ].join(" ")}>
                    {displayHours}:{displayMinutes}:{displaySeconds}
                </span>
            )}

            {!timerRunning && !timerExpired && (
                <ActionButton
                    icon="bx bx-play"
                    text="Start Timer"
                    onClick={() => {
                        if (!timerUnset) {
                            setTimerRunning(true);
                            setTimerPaused(false);
                            setTimerExpired(false);
                            enableSounds && startSound.play();
                        }
                    }}
                    disabled={timerUnset}
                    titlePosition="top"
                />
            )}
            {timerRunning && !timerExpired && !timerPaused && (
                <ActionButton
                    icon="bx bx-pause"
                    text="Pause Timer"
                    onClick={() => {
                        setTimerRunning(false);
                        setTimerPaused(true);
                        enableSounds && selectSound.play();
                    }}
                    titlePosition="top"
                />
            )}
             {(timerExpired || timerRunning || timerPaused) && (
                <ActionButton
                    icon="bx bx-stop"
                    text="Reset Timer"
                    onClick={() => {
                        setTimerRunning(false);
                        setTimerPaused(false);
                        setTimerExpired(false);
                        setHours(initialHours);
                        setMinutes(initialMinutes);
                        setSeconds(initialSeconds);
                        setRemainingSeconds(initialHours * 3600 + initialMinutes * 60 + initialSeconds);
                        enableSounds && endSound.play();
                    }}
                    titlePosition="top"
                />
            )}
        </div>
    )
}
