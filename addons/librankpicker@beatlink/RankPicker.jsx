import {
    useActiveNoteContext,
    useNoteProperty,
    useNoteLabel,
} from "trilium:preact";
import { FormNumber } from "FormNumber.jsx"

export function RankPicker({ constants, onAfterChange }) {
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
                        onAfterChange()
                    }}
                />
            </div>
        </div>
    )
}
