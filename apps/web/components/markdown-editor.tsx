'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import {
	Bold,
	Code,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	List,
	ListOrdered,
	Minus,
	Quote,
	Redo,
	Undo,
} from 'lucide-react';
import { useEffect, useCallback } from 'react';

interface MarkdownEditorProps {
	content: string;
	onChange: (markdown: string) => void;
	placeholder?: string;
	readOnly?: boolean;
	minHeight?: string;
	className?: string;
}

function ToolbarButton({
	onClick,
	active,
	disabled,
	title,
	children,
}: {
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`p-1.5 transition-colors ${
				active
					? 'text-foreground bg-elevated'
					: 'text-muted-foreground hover:text-foreground hover:bg-elevated/50'
			} ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
		>
			{children}
		</button>
	);
}

export function MarkdownEditor({
	content,
	onChange,
	placeholder = 'Start writing...',
	readOnly = false,
	minHeight = '200px',
	className = '',
}: MarkdownEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
			}),
			Placeholder.configure({ placeholder }),
			Markdown.configure({
				html: false,
				transformPastedText: true,
				transformCopiedText: true,
			}),
		],
		content,
		editable: !readOnly,
		onUpdate: ({ editor: e }) => {
			const md = (e.storage as any).markdown.getMarkdown();
			onChange(md);
		},
		editorProps: {
			attributes: {
				class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none prose-headings:font-medium prose-headings:tracking-tight prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-pre:my-2 prose-pre:bg-elevated prose-pre:border prose-pre:border-border prose-code:text-xs prose-code:font-mono prose-blockquote:border-l-2 prose-blockquote:border-muted-foreground/30 prose-blockquote:pl-4 prose-blockquote:text-muted-foreground prose-hr:border-border text-sm`,
			},
		},
	});

	// Sync external content changes
	useEffect(() => {
		if (!editor) return;
		const current = (editor.storage as any).markdown.getMarkdown();
		if (current !== content) {
			editor.commands.setContent(content);
		}
	}, [content, editor]);

	useEffect(() => {
		if (!editor) return;
		editor.setEditable(!readOnly);
	}, [readOnly, editor]);

	const S = 13;

	if (!editor) return null;

	if (readOnly) {
		return (
			<div className={`${className}`}>
				<EditorContent
					editor={editor}
					style={{ minHeight }}
				/>
			</div>
		);
	}

	return (
		<div className={`border border-input ${className}`}>
			{/* Toolbar */}
			<div className="flex items-center gap-0 border-b border-border px-1 py-0.5 bg-surface flex-wrap">
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleBold().run()}
					active={editor.isActive('bold')}
					title="Bold"
				>
					<Bold size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleItalic().run()}
					active={editor.isActive('italic')}
					title="Italic"
				>
					<Italic size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleCode().run()}
					active={editor.isActive('code')}
					title="Inline code"
				>
					<Code size={S} />
				</ToolbarButton>

				<div className="w-px h-4 bg-border mx-1" />

				<ToolbarButton
					onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
					active={editor.isActive('heading', { level: 1 })}
					title="Heading 1"
				>
					<Heading1 size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
					active={editor.isActive('heading', { level: 2 })}
					title="Heading 2"
				>
					<Heading2 size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
					active={editor.isActive('heading', { level: 3 })}
					title="Heading 3"
				>
					<Heading3 size={S} />
				</ToolbarButton>

				<div className="w-px h-4 bg-border mx-1" />

				<ToolbarButton
					onClick={() => editor.chain().focus().toggleBulletList().run()}
					active={editor.isActive('bulletList')}
					title="Bullet list"
				>
					<List size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
					active={editor.isActive('orderedList')}
					title="Ordered list"
				>
					<ListOrdered size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
					active={editor.isActive('blockquote')}
					title="Blockquote"
				>
					<Quote size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().toggleCodeBlock().run()}
					active={editor.isActive('codeBlock')}
					title="Code block"
				>
					<Code size={S} className="opacity-60" />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().setHorizontalRule().run()}
					title="Horizontal rule"
				>
					<Minus size={S} />
				</ToolbarButton>

				<div className="flex-1" />

				<ToolbarButton
					onClick={() => editor.chain().focus().undo().run()}
					disabled={!editor.can().undo()}
					title="Undo"
				>
					<Undo size={S} />
				</ToolbarButton>
				<ToolbarButton
					onClick={() => editor.chain().focus().redo().run()}
					disabled={!editor.can().redo()}
					title="Redo"
				>
					<Redo size={S} />
				</ToolbarButton>
			</div>

			{/* Editor */}
			<div className="px-3 py-2" style={{ minHeight }}>
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}

/**
 * Read-only markdown renderer using tiptap for consistent rendering.
 */
export function MarkdownPreview({
	content,
	className = '',
}: {
	content: string;
	className?: string;
}) {
	return (
		<MarkdownEditor
			content={content}
			onChange={() => {}}
			readOnly
			minHeight="auto"
			className={className}
		/>
	);
}
