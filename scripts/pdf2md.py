import sys
import pymupdf4llm

def main():
    if len(sys.argv) < 2:
        print("Usage: python pdf2md.py <input.pdf> [output.md]")
        sys.exit(1)

    input_path = sys.argv[1]
    
    try:
        # Convert PDF to Markdown
        md_text = pymupdf4llm.to_markdown(input_path)
        
        if len(sys.argv) >= 3:
            output_path = sys.argv[2]
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(md_text)
            print(f"Successfully converted '{input_path}' to '{output_path}'")
        else:
            print(md_text)
            
    except Exception as e:
        print(f"Error converting file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
