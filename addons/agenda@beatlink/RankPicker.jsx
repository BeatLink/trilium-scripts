import {
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
} from "trilium:preact";
import { FormNumber } from "FormNumber.jsx"

const { updateTaskLists } = require("libAgendaOverview.js")

export function RankPicker({ constants, ids }) {
    const { note } = useActiveNoteContext();
    const noteId = useNoteProperty(note, "noteId");
    const [rank, setRank] = useNoteLabel(note, constants.RANK_LABEL)

    return (
        <div>
            <div>
                <label>Rank</label>
                <FormNumber
                    value={rank ?? 0}
                    onChange={value => {
                        setRank(value)
                        updateTaskLists(ids.profileNoteIds, constants, ids.icalNoteId)
                    }}
                />
            </div>
        </div>
    )
}
