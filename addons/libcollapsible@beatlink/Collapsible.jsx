export function Collapsible({
        label,
        expanded,
        onToggle,
        className,
        children
    }) {
    return (
        <details
            className={className ?? ""}
            open={expanded}
            onToggle={(e) => {onToggle?.(e);}}
        >
            <summary>{label}</summary>
            <div>{children}</div>
        </details>
    )
}
