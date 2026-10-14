/* Project 1: Pomodoro Timer */
(function () {
  "use strict";

  function initializePomodoroTimer() {
    const app = document.querySelector("[data-pomodoro-app]");
    if (!app || app.dataset.initialized === "true") return;
    app.dataset.initialized = "true";

    const timerDisplay = app.querySelector("[data-timer-display]");
    const phaseDisplay = app.querySelector("[data-phase-display]");
    const pomodoroDisplay = app.querySelector("[data-pomodoro-display]");
    const statusDisplay = app.querySelector("[data-status]");
    const readyPanel = app.querySelector("[data-ready-panel]");
    const focusControls = app.querySelector("[data-focus-controls]");
    const pauseButton = app.querySelector("[data-pause]");
    const stopRequestButton = app.querySelector("[data-stop-request]");
    const stopConfirmPanel = app.querySelector("[data-stop-confirm-panel]");
    const stopPhraseInput = app.querySelector("[data-stop-phrase]");
    const stopConfirmButton = app.querySelector("[data-stop-confirm]");
    const alarmPanel = app.querySelector("[data-alarm-panel]");
    const alarmStopButton = app.querySelector("[data-alarm-stop]");
    const nextPomodoroPanel = app.querySelector("[data-next-panel]");
    const nextYesButton = app.querySelector("[data-next-yes]");
    const nextNoButton = app.querySelector("[data-next-no]");
    const doNotStartPanel = app.querySelector("[data-do-not-start-panel]");
    const doNotStartInput = app.querySelector("[data-do-not-start-phrase]");
    const doNotStartConfirm = app.querySelector("[data-do-not-start-confirm]");
    const doNotStartCancel = app.querySelector("[data-do-not-start-cancel]");
    const longBreakPanel = app.querySelector("[data-long-break-panel]");
    const longBreakStart = app.querySelector("[data-long-break-start]");
    const longBreakStop = app.querySelector("[data-long-break-stop]");
    const longBreakControls = app.querySelector("[data-long-break-controls]");
    const focusAudio = new Audio();
    const alarmAudio = new Audio("../assets/focus-sounds-pomodoro/alarm-clock.mp3");

    const FOCUS_SECONDS = 25 * 60;
    const SHORT_BREAK_SECONDS = 5 * 60;
    let pomodoroNumber = 1;
    let phase = "ready";
    let remainingSeconds = FOCUS_SECONDS;
    let intervalId = null;
    let isPaused = false;
    let selectedLongBreakSeconds = 15 * 60;

    focusAudio.loop = true;
    alarmAudio.loop = true;
    alarmAudio.preload = "auto";

    function formatTime(totalSeconds) {
      const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
      const seconds = (totalSeconds % 60).toString().padStart(2, "0");
      return `${minutes}:${seconds}`;
    }

    function render() {
      timerDisplay.textContent = formatTime(remainingSeconds);
      pomodoroDisplay.textContent = `Pomodoro ${Math.min(pomodoroNumber, 4)} of 4`;
      const phaseNames = {
        ready: "Ready to Focus",
        focus: "Focus",
        shortBreak: "Short Break",
        focusAlarm: "Focus Complete",
        breakAlarm: "Short Break Complete",
        next: "Continue?",
        longBreakChoice: "Long Break",
        longBreak: "Long Break",
        longBreakAlarm: "Long Break Complete",
        stopped: "Session Reset"
      };
      phaseDisplay.textContent = phaseNames[phase] || "Pomodoro Timer";
      pauseButton.textContent = isPaused ? "Resume" : "Pause";
      pauseButton.setAttribute("aria-pressed", String(isPaused));
    }

    function setStatus(message) {
      statusDisplay.textContent = message;
    }

    function showOnly(panel) {
      [readyPanel, focusControls, stopConfirmPanel, alarmPanel, nextPomodoroPanel,
        doNotStartPanel, longBreakPanel, longBreakControls].forEach((element) => {
        if (element) element.hidden = element !== panel;
      });
    }

    function stopInterval() {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    }

    function stopFocusAudio() {
      focusAudio.pause();
      try { focusAudio.currentTime = 0; } catch (_) {}
    }

    function stopAlarmAudio() {
      alarmAudio.pause();
      try { alarmAudio.currentTime = 0; } catch (_) {}
    }

    function playAudio(audio, description) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          setStatus(`${description} could not play. Check that the audio file exists and that your browser allows playback.`);
        });
      }
    }

    function playFocusSound() {
      const soundFiles = {
        1: "rain-heavy-loud.mp3",
        2: "rain-water-dripping-fast-hard.mp3",
        3: "light-rain.mp3",
        4: "rain-on-car-heavy.mp3"
      };
      const soundNumber = Math.min(pomodoroNumber, 4);
      const source = `../assets/focus-sounds-pomodoro/${soundFiles[soundNumber]}`;
      if (!focusAudio.src.endsWith(source)) {
        focusAudio.src = source;
      }
      focusAudio.loop = true;
      playAudio(focusAudio, `Focus sound ${soundNumber}`);
    }

    function startCountdown(onComplete) {
      stopInterval();
      intervalId = window.setInterval(() => {
        if (isPaused) return;
        remainingSeconds -= 1;
        render();
        if (remainingSeconds <= 0) {
          remainingSeconds = 0;
          stopInterval();
          render();
          onComplete();
        }
      }, 1000);
    }

    function startFocus() {
      stopInterval();
      stopAlarmAudio();
      stopFocusAudio();
      phase = "focus";
      remainingSeconds = FOCUS_SECONDS;
      isPaused = false;
      showOnly(focusControls);
      stopConfirmPanel.hidden = true;
      stopPhraseInput.value = "";
      setStatus("Focus sound is playing. Use Pause to pause the timer and sound. To stop and reset this focus timer, choose Stop and enter STOP THE TIMER.");
      render();
      playFocusSound();
      startCountdown(beginFocusAlarm);
    }

    function beginFocusAlarm() {
      stopFocusAudio();
      phase = "focusAlarm";
      isPaused = false;
      showOnly(alarmPanel);
      setStatus("Your 25-minute focus session is complete. Stop the alarm to begin the 5-minute short break.");
      render();
      playAudio(alarmAudio, "Alarm sound");
    }

    function startShortBreak() {
      stopAlarmAudio();
      phase = "shortBreak";
      remainingSeconds = SHORT_BREAK_SECONDS;
      isPaused = false;
      showOnly(null);
      setStatus("Short break in progress. Your Pomodoro's predefined focus sound will play throughout the break.");
      render();
      playFocusSound();
      startCountdown(beginBreakAlarm);
    }

    function beginBreakAlarm() {
      stopFocusAudio();
      phase = "breakAlarm";
      isPaused = false;
      showOnly(alarmPanel);
      setStatus("Your 5-minute short break is complete. Stop the alarm to continue.");
      render();
      playAudio(alarmAudio, "Alarm sound");
    }

    function handleShortBreakComplete() {
      stopAlarmAudio();
      if (pomodoroNumber >= 4) {
        phase = "longBreakChoice";
        remainingSeconds = 0;
        showOnly(longBreakPanel);
        setStatus("You completed four consecutive Pomodoros. Choose a 15-minute or 30-minute long break.");
        render();
        return;
      }
      phase = "next";
      remainingSeconds = 0;
      showOnly(nextPomodoroPanel);
      setStatus(`Pomodoro ${pomodoroNumber} is complete. Would you like to start Pomodoro ${pomodoroNumber + 1}?`);
      render();
    }

    function resetSession(message) {
      stopInterval();
      stopFocusAudio();
      stopAlarmAudio();
      pomodoroNumber = 1;
      phase = "ready";
      remainingSeconds = FOCUS_SECONDS;
      isPaused = false;
      stopPhraseInput.value = "";
      doNotStartInput.value = "";
      showOnly(readyPanel);
      setStatus(message || "Your Pomodoro session has reset. Start when you're ready.");
      render();
    }

    app.querySelectorAll("[data-start-first]").forEach((button) => {
      button.addEventListener("click", () => {
        if (phase === "ready") startFocus();
      });
    });

    app.querySelectorAll("[data-decline-first]").forEach((button) => {
      button.addEventListener("click", () => {
        setStatus("Pomodoro not started. Choose Yes whenever you're ready.");
      });
    });

    pauseButton.addEventListener("click", () => {
      if (phase !== "focus") return;
      isPaused = !isPaused;
      if (isPaused) {
        focusAudio.pause();
        setStatus("Focus timer and focus sound paused. Choose Resume to continue.");
      } else {
        playAudio(focusAudio, "Focus sound");
        setStatus("Focus timer and focus sound resumed.");
      }
      render();
    });

    stopRequestButton.addEventListener("click", () => {
      if (phase !== "focus") return;
      stopConfirmPanel.hidden = false;
      stopPhraseInput.focus();
      setStatus("The timer and focus sound are still running. Type STOP THE TIMER exactly to reset this focus timer.");
    });

    stopConfirmButton.addEventListener("click", () => {
      if (stopPhraseInput.value.trim() !== "STOP THE TIMER") {
        setStatus("The phrase did not match. Type STOP THE TIMER exactly. The timer and focus sound are still running.");
        return;
      }
      stopInterval();
      stopFocusAudio();
      stopAlarmAudio();
      phase = "ready";
      remainingSeconds = FOCUS_SECONDS;
      isPaused = false;
      stopConfirmPanel.hidden = true;
      showOnly(readyPanel);
      setStatus("The focus timer has reset to 25:00. Your current Pomodoro number has not changed.");
      render();
    });

    alarmStopButton.addEventListener("click", () => {
      if (phase === "focusAlarm") {
        startShortBreak();
      } else if (phase === "breakAlarm") {
        handleShortBreakComplete();
      } else if (phase === "longBreakAlarm") {
        resetSession("Long break complete. Your Pomodoro session has reset to square one.");
      }
    });

    nextYesButton.addEventListener("click", () => {
      if (phase !== "next") return;
      pomodoroNumber += 1;
      startFocus();
    });

    nextNoButton.addEventListener("click", () => {
      if (phase !== "next") return;
      showOnly(doNotStartPanel);
      doNotStartInput.focus();
      setStatus("To reset the session, type DO NOT START exactly into the text field.");
    });

    doNotStartConfirm.addEventListener("click", () => {
      if (doNotStartInput.value.trim() !== "DO NOT START") {
        setStatus("The phrase did not match. Type DO NOT START exactly to reset the session.");
        return;
      }
      resetSession("You chose not to continue. Your Pomodoro session has reset to square one.");
    });

    doNotStartCancel.addEventListener("click", () => {
      if (phase !== "next") return;

      doNotStartInput.value = "";
      showOnly(nextPomodoroPanel);
      setStatus("Choose Yes to start the next focus session or No to reset the session.");
    });

    app.querySelectorAll('input[name="long-break-duration"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) selectedLongBreakSeconds = Number(radio.value);
      });
    });

    longBreakStart.addEventListener("click", () => {
      if (phase !== "longBreakChoice") return;
      stopInterval();
      stopFocusAudio();
      stopAlarmAudio();
      phase = "longBreak";
      remainingSeconds = selectedLongBreakSeconds;
      isPaused = false;
      showOnly(longBreakControls);
      setStatus(`Long break started for ${selectedLongBreakSeconds / 60} minutes. You can stop it at any time.`);
      render();
      startCountdown(() => {
        resetSession("Long break complete. Your Pomodoro session has reset to square one.");
      });
    });

    longBreakStop.addEventListener("click", () => {
      resetSession("Long break stopped. Your Pomodoro session has reset to square one.");
    });

    showOnly(readyPanel);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePomodoroTimer);
  } else {
    initializePomodoroTimer();
  }
})();
