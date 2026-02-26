# Local LLM Integration for NLP2CMD

Complete setup for integrating local Large Language Models with the NLP2CMD framework, with full Polish language support.

## 🚀 Quick Start

```bash
# 1. Run setup script
./setup_local_llm.sh

# 2. Test mock implementation
python3 mock_polish_llm_test.py

# 3. Test full integration
python3 local_llm_integration.py
```

## 📋 Features

### 🤖 Multiple LLM Backends
- **Mock Client** - For testing without actual models
- **GGUF Models** - Local models via llama-cpp-python (Polka-1.1B, TinyLlama)
- **Ollama** - Local Ollama server integration
- **OpenAI-Compatible** - Any local API server (LM Studio, text-generation-webui)

### 🇵🇱 Polish Language Support
- Polish system prompts and responses
- Polish query understanding and intent detection
- Localized error messages and feedback
- Support for Polish diacritics and grammar

### 🔧 NLP2CMD Integration
- Full integration with nlp2cmd planner and executor
- Multi-domain support (SQL, Shell, Docker, Kubernetes, Browser)
- Action registry and validation
- Plan execution with tracing

## 📁 Project Structure

```
broxeen/
├── local_llm_integration.py     # Main integration script
├── mock_polish_llm_test.py      # Mock test (user provided)
├── local_llm_requirements.txt   # Python dependencies
├── setup_local_llm.sh          # Setup script
├── local_llm_config.json       # Configuration file
└── models/                     # Local model storage
    └── polka-1.1b-chat.gguf   # Polish GGUF model
```

## 🛠️ Installation

### Automatic Setup
```bash
# Clone and setup
git clone <repository>
cd broxeen
./setup_local_llm.sh
```

### Manual Setup
```bash
# Create virtual environment
python3 -m venv venv_llm
source venv_llm/bin/activate

# Install dependencies
pip install -r local_llm_requirements.txt

# Download Polish model (optional)
mkdir -p models
wget -O models/polka-1.1b-chat.gguf \
    https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf
```

## 🎯 Usage Examples

### Mock Testing
```python
from mock_polish_llm_test import MockPolishNLP2CMD

# Initialize mock client
polish_nlp = MockPolishNLP2CMD("mock-polka-1.1b")

# Process query
result = polish_nlp.process_query("Otwórz https://google.pl")
print(result["plan"])
```

### GGUF Model Integration
```python
from local_llm_integration import LocalPolishNLP2CMD, LocalLLMConfig

# Configure GGUF model
config = LocalLLMConfig(
    model_type="gguf",
    gguf_model_path="models/polka-1.1b-chat.gguf",
    temperature=0.3,
    max_tokens=500
)

# Initialize
polish_nlp = LocalPolishNLP2CMD(config)

# Process query
result = await polish_nlp.process_query("Pokaż pliki .log")
```

### Ollama Integration
```python
# Configure Ollama
config = LocalLLMConfig(
    model_type="ollama",
    ollama_model="qwen2.5-coder:7b",
    ollama_base_url="http://localhost:11434"
)

polish_nlp = LocalPolishNLP2CMD(config)
result = await polish_nlp.process_query("Sprawdź kontenery docker")
```

## 🗣️ Polish Language Examples

### Web Automation
```python
# Query: "Otwórz https://www.prototypowanie.pl/kontakt/ i wypełnij formularz"
{
  "steps": [
    {
      "action": "playwright_open",
      "params": {"url": "https://www.prototypowanie.pl/kontakt/"},
      "store_as": "page"
    },
    {
      "action": "playwright_fill",
      "params": {"selector": "form input", "value": "..."},
      "store_as": "filled"
    }
  ]
}
```

### File Operations
```python
# Query: "Pokaż wszystkie pliki .log w katalogu /var/log"
{
  "steps": [
    {
      "action": "shell_find",
      "params": {"pattern": "/var/log/*.log"},
      "store_as": "log_files"
    }
  ]
}
```

### Database Queries
```python
# Query: "Wyświetl 10 ostatnich zamówień z bazy danych"
{
  "steps": [
    {
      "action": "sql_select",
      "params": {
        "table": "orders",
        "columns": "*",
        "order": "created_at DESC",
        "limit": 10
      },
      "store_as": "orders"
    }
  ]
}
```

## ⚙️ Configuration

### Model Configuration
```json
{
  "default_model_type": "gguf",
  "models": {
    "gguf": {
      "type": "gguf",
      "model_path": "models/polka-1.1b-chat.gguf",
      "n_ctx": 2048,
      "n_gpu_layers": 0,
      "temperature": 0.3,
      "max_tokens": 500
    },
    "ollama": {
      "type": "ollama",
      "model": "qwen2.5-coder:7b",
      "base_url": "http://localhost:11434"
    }
  },
  "language": "pl",
  "system_prompt_language": "polish"
}
```

### Polish System Prompts
The system uses Polish-specific prompts for better understanding:

```
Jesteś asystentem generującym plany wykonania dla poleceń w języku polskim.
Twoim zadaniem jest tworzenie planów wykonania krok po kroku.
Format odpowiedzi (tylko JSON):
{
  "steps": [
    {
      "action": "nazwa_akcji",
      "params": {"parametr": "wartość"},
      "store_as": "zmienna"
    }
  ]
}
```

## 🧪 Testing

### Mock Tests
```bash
python3 mock_polish_llm_test.py
```

### Full Integration Tests
```bash
python3 local_llm_integration.py
```

### Domain-Specific Tests
```python
# Test SQL generation
result = await polish_nlp.process_query("Pokaż użytkowników z Warszawy")

# Test Shell commands
result = await polish_nlp.process_query("Znajdź pliki większe niż 100MB")

# Test Docker operations
result = await polish_nlp.process_query("Pokaż wszystkie kontenery")
```

## 🚀 Performance Optimization

### GPU Acceleration
```python
config = LocalLLMConfig(
    model_type="gguf",
    gguf_n_gpu_layers=-1,  # All layers on GPU
    gguf_n_ctx=4096,       # Larger context
)
```

### Model Selection
- **Polka-1.1B**: Best for Polish language, small footprint
- **TinyLlama**: Good general-purpose, faster
- **Qwen2.5-Coder**: Excellent for code generation
- **Custom models**: Any GGUF format model

## 🔧 Advanced Usage

### Custom Prompts
```python
class CustomPolishLLMClient(GGUFPolishLLMClient):
    def _get_polish_system_prompt(self) -> str:
        return """Jesteś specjalistą od DevOps w języku polskim.
        Generuj plany wykonania dla operacji systemowych."""
```

### Action Extensions
```python
# Add custom actions to the registry
from nlp2cmd.registry import get_registry

registry = get_registry()
registry.register_action("custom_backup", {
    "description": "Tworzy kopię zapasową",
    "params": {"source": "string", "destination": "string"}
})
```

### Integration with Broxeen
```python
# Use in Broxeen project
from local_llm_integration import LocalPolishNLP2CMD

# Initialize with Broxeen context
broxeen_config = LocalLLMConfig(model_type="mock")
nlp2cmd = LocalPolishNLP2CMD(broxeen_config)

# Process Broxeen commands
result = await nlp2cmd.process_query("Sprawdź status kamer")
```

## 🐛 Troubleshooting

### Common Issues

1. **Import Error: nlp2cmd not found**
   ```bash
   pip install nlp2cmd[all]
   # or add to path:
   export PYTHONPATH="/path/to/nlp2cmd:$PYTHONPATH"
   ```

2. **GGUF Model Loading Error**
   ```bash
   # Install llama-cpp-python with GPU support
   pip install llama-cpp-python --prefer-binary --extra-index-url=https://jllllll.github.io/llama-cpp-python-cuBLAS-wheels/AVX2/cu118
   ```

3. **Ollama Connection Failed**
   ```bash
   # Start Ollama server
   ollama serve
   
   # Pull model
   ollama pull qwen2.5-coder:7b
   ```

4. **Memory Issues**
   ```python
   # Reduce context size
   config.gguf_n_ctx = 1024
   
   # Use CPU instead of GPU
   config.gguf_n_gpu_layers = 0
   ```

### Debug Mode
```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Enable verbose output
config = LocalLLMConfig(model_type="mock")
nlp2cmd = LocalPolishNLP2CMD(config)
```

## 📚 References

- [NLP2CMD Documentation](https://github.com/wronai/nlp2cmd)
- [Polka-1.1B Model](https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF)
- [llama-cpp-python](https://github.com/abetlen/llama-cpp-python)
- [Ollama](https://ollama.ai/)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Submit pull request

## 📄 License

This integration follows the same license as NLP2CMD (Apache-2.0).

---

**Generated for Broxeen project** - Local AI integration with Polish language support.
