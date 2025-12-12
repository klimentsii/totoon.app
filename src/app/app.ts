import { Component, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [FormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  jsonInput = signal('');
  isDragOver = signal(false);

  toonOutput = computed(() => {
    const jsonString = this.jsonInput();
    if (!jsonString.trim()) {
      return '';
    }

    try {
      const jsonObject = JSON.parse(jsonString);
      return this.jsonToToon(jsonObject);
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : 'Invalid JSON format'}`;
    }
  });

  isOutputEmpty = computed(() => {
    const output = this.toonOutput();
    return !output.trim() || output.startsWith('Error:');
  });

  inputTokens = computed(() => {
    const input = this.jsonInput();
    if (!input.trim()) {
      return 0;
    }
    return input.trim().split(/\s+/).filter(word => word.length > 0).length;
  });

  outputTokens = computed(() => {
    const output = this.toonOutput();
    if (!output.trim() || output.startsWith('Error:')) {
      return 0;
    }
    return output.trim().split(/\s+/).filter(word => word.length > 0).length;
  });

  onJsonChange(value: string): void {
    this.jsonInput.set(value);
  }

  async onPaste(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.formatAndSetJson(text);
      }
    } catch (error) {
      console.error('Failed to read clipboard:', error);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.processFile(file);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      this.processFile(file);
    }
  }

  private processFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        this.formatAndSetJson(content);
      }
    };
    reader.readAsText(file);
  }

  private formatAndSetJson(jsonString: string): void {
    try {
      const jsonObject = JSON.parse(jsonString);
      const formatted = JSON.stringify(jsonObject, null, 2);
      this.jsonInput.set(formatted);
    } catch (error) {
      this.jsonInput.set(jsonString);
    }
  }

  async onCopy(): Promise<void> {
    const text = this.toonOutput();
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }

  onSave(): void {
    const text = this.toonOutput();
    if (!text) {
      return;
    }

    this.downloadFile(text, 'output.toon');
  }

  async onSaveAs(): Promise<void> {
    const text = this.toonOutput();
    if (!text) {
      return;
    }

    if ('showSaveFilePicker' in window) {
      try {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: 'output.toon',
          types: [
            {
              description: 'Toon files',
              accept: {
                'text/plain': ['.toon'],
              },
            },
          ],
        });

        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Failed to save file:', error);
          this.downloadFile(text, 'output.toon');
        }
      }
    } else {
      this.downloadFile(text, 'output.toon');
    }
  }

  private downloadFile(text: string, filename: string): void {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private jsonToToon(obj: any): string {
    if (obj === null) {
      return 'null';
    }

    if (typeof obj === 'string') {
      return obj;
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return '[]:';
      }

      const firstItem = obj[0];
      if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
        const keys = Object.keys(firstItem);
        const allSameStructure = obj.every(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            !Array.isArray(item) &&
            Object.keys(item).length === keys.length &&
            keys.every((key) => key in item)
        );

        if (allSameStructure && keys.length > 0) {
          const header = `[${obj.length}]{${keys.join(',')}}:`;
          const rows = obj.map((item) => {
            return keys.map((key) => this.formatToonValue(item[key])).join(',');
          });
          return `${header}\n${rows.join('\n')}`;
        }
      }

      const items = obj.map((item) => this.jsonToToon(item));
      return items.join('\n');
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return '{}:';
      }

      const lines: string[] = [];
      keys.forEach((key) => {
        const value = obj[key];

        if (Array.isArray(value) && value.length > 0) {
          const firstItem = value[0];
          if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
            const arrayKeys = Object.keys(firstItem);
            const allSameStructure = value.every(
              (item) =>
                typeof item === 'object' &&
                item !== null &&
                !Array.isArray(item) &&
                Object.keys(item).length === arrayKeys.length &&
                arrayKeys.every((k) => k in item)
            );

            if (allSameStructure && arrayKeys.length > 0) {
              const header = `${key}[${value.length}]{${arrayKeys.join(',')}}:`;
              lines.push(header);
              const rows = value.map((item) => {
                return arrayKeys.map((k) => this.formatToonValue(item[k])).join(',');
              });
              lines.push(...rows);
              return;
            }
          }
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const nested = this.jsonToToon(value);
          if (nested.includes('\n') || nested.includes('[') || nested.includes('{')) {
            lines.push(`${key}:`);
            nested.split('\n').forEach((line) => {
              lines.push(`  ${line}`);
            });
          } else {
            lines.push(`${key}: ${nested}`);
          }
        } else {
          const formattedValue = this.formatToonValue(value);
          lines.push(`${key}: ${formattedValue}`);
        }
      });

      return lines.join('\n');
    }

    return String(obj);
  }

  private formatToonValue(value: any): string {
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return String(value);
  }
}
