// The canonical label-name vocabulary for this addon's task notes. Defined
// once, here, and required directly by every widget in this same addon —
// the shared agenda libraries never import this themselves, they take a
// `constants` object as a parameter instead (see each lib*@beatlink's
// README's "dependency injection" section for why).
module.exports = {
    START_DATETIME_LABEL: "startDateTime",
    START_DATE_LABEL: "startDate",
    START_TIME_LABEL: "startTime",
    DUE_DATETIME_LABEL: "dueDateTime",
    DUE_DATE_LABEL: "endDate",
    DUE_TIME_LABEL: "endTime",
    DURATION_LABEL: "duration",
    RECURRENCE_LABEL: "recurrence",
    RANK_LABEL: "rank"
}
