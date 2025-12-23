import { Component, signal, computed, effect, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

type TokenizerModel = 'openai' | 'anthropic' | 'google' | 'xai' | 'llama';

@Component({
  selector: 'app-root',
  imports: [FormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  jsonInput = signal('');
  originalJsonInput = signal('');
  toonManualInput = signal('');
  isDragOver = signal(false);
  showCopiedNotification = signal(false);
  selectedModel = signal<TokenizerModel>('openai');
  isDropdownOpen = signal(false);
  
  models = [
    { value: 'openai', label: 'OpenAI ChatGPT', disabled: false },
    { value: 'anthropic', label: 'Anthropic (Claude)', disabled: true },
    { value: 'google', label: 'Google (Gemini)', disabled: true },
    { value: 'xai', label: 'xAI (Grok-3/4)', disabled: true },
    { value: 'llama', label: 'Llama (Meta)', disabled: true },
  ];

  toonOutput = computed(() => {
    if (this.toonManualInput().trim()) {
      return this.toonManualInput();
    }
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

  hasError = computed(() => {
    const output = this.toonOutput();
    return output.startsWith('Error:');
  });

  private openaiTokenizer: any = null;
  private anthropicTokenizer: any = null;

  private openaiTokenizerLoading = false;
  private anthropicTokenizerLoading = false;

  private async initializeOpenAITokenizer(): Promise<void> {
    if (this.openaiTokenizer) return;
    if (this.openaiTokenizerLoading) return;
    
    this.openaiTokenizerLoading = true;
    try {
      const modulePath = 'js-tiktoken' + '/lite';
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      const tiktokenModule = await dynamicImport(modulePath).catch(() => null);
      if (!tiktokenModule || !tiktokenModule.Tiktoken) {
        throw new Error('js-tiktoken module not found');
      }
      const { Tiktoken } = tiktokenModule;
      const res = await fetch('https://tiktoken.pages.dev/js/cl100k_base.json');
      if (!res.ok) {
        throw new Error(`Failed to fetch cl100k_base: ${res.status}`);
      }
      const cl100k_base = await res.json();
      this.openaiTokenizer = new Tiktoken(cl100k_base);
    } catch (error) {
      this.openaiTokenizer = null;
    } finally {
      this.openaiTokenizerLoading = false;
    }
  }

  private async initializeAnthropicTokenizer(): Promise<void> {
    if (this.anthropicTokenizer) return;
    if (this.anthropicTokenizerLoading) return;
    
    this.anthropicTokenizerLoading = true;
    try {
      const modulePath = '@anthropic-ai' + '/tokenizer';
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      const anthropicModule = await dynamicImport(modulePath).catch(() => null);
      if (!anthropicModule || !anthropicModule.countTokens) {
        throw new Error('@anthropic-ai/tokenizer module not found');
      }
      const { countTokens } = anthropicModule;
      this.anthropicTokenizer = { countTokens };
    } catch (error) {
      this.anthropicTokenizer = null;
    } finally {
      this.anthropicTokenizerLoading = false;
    }
  }

  private async countTokens(text: string): Promise<number> {
    if (!text || !text.trim()) {
      return 0;
    }

    const trimmed = text.trim();
    const model = this.selectedModel();

    try {
      switch (model) {
        case 'openai':
          await this.initializeOpenAITokenizer();
          if (this.openaiTokenizer) {
            try {
              if (typeof this.openaiTokenizer.encode === 'function') {
                const encoded = this.openaiTokenizer.encode(trimmed);
                if (Array.isArray(encoded)) {
                  return encoded.length;
                }
              }
              return Math.ceil(trimmed.length / 4);
            } catch (error) {
              return Math.ceil(trimmed.length / 4);
            }
          }
          return Math.ceil(trimmed.length / 4);

        case 'anthropic':
          await this.initializeAnthropicTokenizer();
          if (this.anthropicTokenizer && typeof this.anthropicTokenizer.countTokens === 'function') {
            try {
              const count = this.anthropicTokenizer.countTokens(trimmed);
              return typeof count === 'number' && !isNaN(count) && count >= 0 
                ? count 
                : Math.ceil(trimmed.length / 4);
            } catch (error) {
              return Math.ceil(trimmed.length / 4);
            }
          }
          return Math.ceil(trimmed.length / 4);

        case 'google':
        case 'xai':
        case 'llama':
          return Math.ceil(trimmed.length / 4);

        default:
          return Math.ceil(trimmed.length / 4);
      }
    } catch (error) {
      return Math.ceil(trimmed.length / 4);
    }
  }

  private tokenCountCache = new Map<string, number>();
  private lastModel: TokenizerModel = 'openai';
  private updateInProgress = false;

  private getCacheKey(text: string, model: TokenizerModel): string {
    return `${model}:${text.substring(0, 100)}:${text.length}`;
  }

  inputTokens = signal(0);
  outputTokens = signal(0);

  constructor() {
    effect(() => {
      const model = this.selectedModel();
      const input = this.jsonInput();
      const output = this.toonOutput();
      
      if (model !== this.lastModel) {
        this.tokenCountCache.clear();
        this.lastModel = model;
        this.updateInProgress = false;
        this.updateTokenCounts(input, output, model).catch(() => {
        });
      } else {
        if (!this.updateInProgress) {
          this.updateTokenCounts(input, output, model).catch(() => {
          });
        }
      }
    });
  }

  private async updateTokenCounts(input: string, output: string, model: TokenizerModel): Promise<void> {
    if (!input || !input.trim() || input.startsWith('Error:')) {
      this.inputTokens.set(0);
    } else {
      const fallback = Math.ceil(input.trim().length / 4);
      this.inputTokens.set(fallback);
    }

    if (!output || !output.trim() || output.startsWith('Error:')) {
      this.outputTokens.set(0);
    } else {
      const fallback = Math.ceil(output.trim().length / 4);
      this.outputTokens.set(fallback);
    }

    if (this.updateInProgress) return;
    this.updateInProgress = true;

    try {
      if (input && input.trim() && !input.startsWith('Error:')) {
        const cacheKey = this.getCacheKey(input, model);
        if (this.tokenCountCache.has(cacheKey)) {
          this.inputTokens.set(this.tokenCountCache.get(cacheKey)!);
        } else {
          try {
            const count = await this.countTokens(input);
            if (typeof count === 'number' && !isNaN(count) && count >= 0) {
              this.tokenCountCache.set(cacheKey, count);
              this.inputTokens.set(count);
            }
          } catch (error) {
          }
        }
      }

      if (output && output.trim() && !output.startsWith('Error:')) {
        const cacheKey = this.getCacheKey(output, model);
        if (this.tokenCountCache.has(cacheKey)) {
          this.outputTokens.set(this.tokenCountCache.get(cacheKey)!);
        } else {
          try {
            const count = await this.countTokens(output);
            if (typeof count === 'number' && !isNaN(count) && count >= 0) {
              this.tokenCountCache.set(cacheKey, count);
              this.outputTokens.set(count);
            }
          } catch (error) {
          }
        }
      }
    } catch (error) {
    } finally {
      this.updateInProgress = false;
    }
  }

  onModelChange(model: TokenizerModel): void {
    try {
      const selectedModelConfig = this.models.find(m => m.value === model);
      if (selectedModelConfig && !selectedModelConfig.disabled) {
        this.selectedModel.set(model);
      }
    } catch (error) {
    }
  }

  toggleDropdown(): void {
    this.isDropdownOpen.set(!this.isDropdownOpen());
  }

  selectModel(model: string): void {
    const modelValue = model as TokenizerModel;
    const selectedModelConfig = this.models.find(m => m.value === modelValue);
    if (selectedModelConfig && !selectedModelConfig.disabled) {
      this.selectedModel.set(modelValue);
      this.isDropdownOpen.set(false);
    }
  }

  getSelectedModelLabel(): string {
    const selected = this.models.find(m => m.value === this.selectedModel());
    return selected ? selected.label : 'OpenAI ChatGPT';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.custom-dropdown')) {
      this.isDropdownOpen.set(false);
    }
  }

  savedTokens = computed(() => {
    if (this.hasError()) {
      return 0;
    }
    const input = this.inputTokens();
    const output = this.outputTokens();
    const saved = input - output;
    return saved > 0 ? saved : 0;
  });

  inputBytes = computed(() => {
    const input = this.jsonInput();
    if (!input.trim() || input.startsWith('Error:')) {
      return 0;
    }
    return new Blob([input]).size;
  });

  outputBytes = computed(() => {
    const output = this.toonOutput();
    if (!output.trim() || output.startsWith('Error:')) {
      return 0;
    }
    return new Blob([output]).size;
  });

  savedBytes = computed(() => {
    if (this.hasError()) {
      return 0;
    }
    const input = this.inputBytes();
    const output = this.outputBytes();
    const saved = input - output;
    return saved > 0 ? saved : 0;
  });

  savedTokensPercent = computed(() => {
    if (this.hasError()) {
      return 0;
    }
    const input = this.inputTokens();
    if (input === 0) {
      return 0;
    }
    const saved = this.savedTokens();
    return Math.round((saved / input) * 100);
  });

  savedDollars = computed(() => {
    if (this.hasError()) {
      return 0;
    }
    const pricePerToken = 0.00006;
    const saved = this.savedTokens();
    return saved * pricePerToken;
  });

  onJsonChange(value: string): void {
    this.jsonInput.set(value);
    if (!value.startsWith('Error:')) {
      this.originalJsonInput.set(value);
    }
    this.toonManualInput.set('');
  }

  onToonChange(value: string): void {
    this.toonManualInput.set(value);
    if (!value.trim()) {
      this.jsonInput.set('');
      this.toonManualInput.set('');
      this.originalJsonInput.set('');
      return;
    }

    try {
      const jsonObject = this.toonToJson(value);
      const formatted = JSON.stringify(jsonObject, null, 2);
      if (!formatted.startsWith('Error:')) {
        this.jsonInput.set(formatted);
      }
    } catch (error) {
      this.jsonInput.set(`Error: ${error instanceof Error ? error.message : 'Invalid TOON format'}`);
    }
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

  onExample(): void {
    const exampleJson = {
      name: "John Doe",
      age: 30,
      city: "New York",
      active: true,
      tags: ["developer", "angular"],
      address: {
        street: "123 Main St",
        zip: "10001"
      }
    };
    const formatted = JSON.stringify(exampleJson, null, 2);
    this.jsonInput.set(formatted);
    this.originalJsonInput.set(formatted);
    this.toonManualInput.set('');
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
      this.originalJsonInput.set(formatted);
      this.toonManualInput.set('');
    } catch (error) {
      this.jsonInput.set(jsonString);
      this.originalJsonInput.set(jsonString);
      this.toonManualInput.set('');
    }
  }

  async onCopy(): Promise<void> {
    const text = this.toonOutput();
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      this.showCopiedNotification.set(true);
      setTimeout(() => {
        this.showCopiedNotification.set(false);
      }, 2000);
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

  private toonToJson(toonString: string): any {
    const lines = toonString.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      return {};
    }

    const firstLine = lines[0].trim();

    if (firstLine === '[]:') {
      return [];
    }

    if (firstLine === '{}:') {
      return {};
    }

    if (firstLine.match(/^\[\d+\]\{.*\}:$/)) {
      return this.parseToonArray(lines);
    }

    return this.parseToonObject(lines);
  }

  private parseToonArray(lines: string[]): any[] {
    if (lines.length === 0) {
      return [];
    }

    const header = lines[0].trim();
    const headerMatch = header.match(/^\[(\d+)\]\{(.+)\}:$/);
    if (!headerMatch) {
      throw new Error('Invalid array header format');
    }

    const count = parseInt(headerMatch[1], 10);
    const keys = headerMatch[2].split(',').map(k => k.trim());

    const result: any[] = [];
    for (let i = 1; i < lines.length && result.length < count; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const item: any = {};
      keys.forEach((key, index) => {
        item[key] = this.parseToonValue(values[index] || '');
      });
      result.push(item);
    }

    return result;
  }

  private parseToonObject(lines: string[]): any {
    const result: any = {};
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }

      if (line.endsWith(':')) {
        const key = line.slice(0, -1).trim();
        
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          
          if (nextLine.match(/^\[\d+\]\{.*\}:$/)) {
            const arrayLines = [nextLine];
            let j = i + 2;
            while (j < lines.length && !lines[j].trim().endsWith(':') && !lines[j].trim().match(/^[^:]+:\s/)) {
              arrayLines.push(lines[j]);
              j++;
            }
            result[key] = this.parseToonArray(arrayLines);
            i = j;
            continue;
          }

          if (nextLine.startsWith('  ')) {
            const nestedLines: string[] = [];
            let j = i + 1;
            while (j < lines.length && lines[j].startsWith('  ')) {
              nestedLines.push(lines[j].substring(2));
              j++;
            }
            result[key] = this.parseToonObject(nestedLines);
            i = j;
            continue;
          }
        }

        if (i + 1 < lines.length) {
          const value = lines[i + 1].trim();
          result[key] = this.parseToonValue(value);
          i += 2;
        } else {
          result[key] = null;
          i++;
        }
      } else {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          result[key] = this.parseToonValue(value);
        }
        i++;
      }
    }

    return result;
  }

  private parseToonValue(value: string): any {
    if (value === 'null') {
      return null;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (value === '') {
      return '';
    }
    const numValue = Number(value);
    if (!isNaN(numValue) && value.trim() !== '') {
      return numValue;
    }
    return value;
  }
}
