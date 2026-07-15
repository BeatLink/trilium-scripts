import { Button } from "trilium:preact"

export function ActionBar({ actions }) {
    return (
        <div>
            {actions.map(({ key, icon, text, onClick }) => (
                <Button key={key} icon={icon} text={text} onClick={onClick} />
            ))}
        </div>
    )
}
