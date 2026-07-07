import { Button } from "trilium:preact"

// A generic row of action buttons — each entry supplies its own icon/text/
// onClick, so this component has no idea what "actions" actually means for
// any given consumer (completing a task, hoisting a note, toggling zen
// mode, ...). Whatever a click should refresh afterward is the caller's own
// concern, folded into that action's own onClick.
export function ActionBar({ actions }) {
    return (
        <div>
            {actions.map(({ key, icon, text, onClick }) => (
                <Button key={key} icon={icon} text={text} onClick={onClick} />
            ))}
        </div>
    )
}
