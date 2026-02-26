#!/bin/bash
# Setup Script for Local LLM Integration with NLP2CMD
# Author: Generated for Broxeen project

set -e

DEPS_ONLY=false
SKIP_MODEL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --deps-only)
            DEPS_ONLY=true
            SKIP_MODEL=true
            shift
            ;;
        --skip-model)
            SKIP_MODEL=true
            shift
            ;;
        *)
            # Unknown argument
            shift
            ;;
    esac
done

echo "🤖 Setting up Local LLM Integration for NLP2CMD"
echo "=================================================="

# Check Python version
python_version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
required_version="3.10"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo "❌ Python $required_version or higher required. Found: $python_version"
    exit 1
fi

echo "✅ Python version: $python_version"

if [ "$DEPS_ONLY" = "true" ]; then
    echo "📦 Installing dependencies only (skip model download)"
else
    echo "📦 Full setup with model download"
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv_llm" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv_llm
fi

# Activate virtual environment
echo "🔄 Activating virtual environment..."
source venv_llm/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "📚 Installing requirements..."
if [ -f "local_llm_requirements.txt" ]; then
    pip install -r local_llm_requirements.txt
else
    echo "❌ Requirements file not found: local_llm_requirements.txt"
    exit 1
fi

# Check nlp2cmd installation
echo "🔍 Checking nlp2cmd installation..."
python3 -c "import nlp2cmd; print(f'✅ nlp2cmd version: {nlp2cmd.__version__}')" || {
    echo "❌ Failed to import nlp2cmd"
    echo "💡 Try installing manually: pip install nlp2cmd[all]"
    exit 1
}

# Create models directory
echo "📁 Creating models directory..."
mkdir -p models

# Download Polish model (optional)
if [ "$SKIP_MODEL" = "false" ]; then
    echo "📥 Checking for Polish GGUF model..."
    model_path="models/polka-1.1b-chat.gguf"

    if [ -f "$model_path" ]; then
        echo "✅ Polish model found: $model_path"
    else
        echo "📥 Downloading Polish model (this may take a while)..."
        
        # Try to download from Hugging Face
        if command -v wget &> /dev/null; then
            wget -O "$model_path" \
                "https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf" \
                --progress=bar:force \
                --timeout=300 \
                --tries=3 || {
                echo "⚠️ Download failed. You can download manually:"
                echo "   wget -O $model_path https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf"
            }
        elif command -v curl &> /dev/null; then
            curl -L -o "$model_path" \
                "https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf" \
                --progress-bar \
                --max-time 300 \
                --retry 3 || {
                echo "⚠️ Download failed. You can download manually:"
                echo "   curl -L -o $model_path https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf"
            }
        else
            echo "❌ Neither wget nor curl found. Please download the model manually:"
            echo "   URL: https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf"
            echo "   Save as: $model_path"
        fi
    fi
else
    echo "⏭️ Skipping model download"
fi

# Check for Ollama (optional)
echo "🦊 Checking for Ollama..."
if command -v ollama &> /dev/null; then
    echo "✅ Ollama found"
    
    # Check if Ollama is running
    if curl -s http://localhost:11434/api/tags &> /dev/null; then
        echo "✅ Ollama server is running"
        
        # Pull a recommended model
        echo "📥 Pulling recommended model: qwen2.5-coder:7b"
        ollama pull qwen2.5-coder:7b || echo "⚠️ Failed to pull model"
    else
        echo "⚠️ Ollama server not running. Start with: ollama serve"
    fi
else
    echo "💡 Install Ollama for additional model support:"
    echo "   curl -fsSL https://ollama.ai/install.sh | sh"
fi

# Create configuration file
echo "⚙️ Creating configuration file..."
cat > local_llm_config.json << EOF
{
  "default_model_type": "mock",
  "models": {
    "mock": {
      "type": "mock",
      "description": "Mock model for testing"
    },
    "gguf": {
      "type": "gguf",
      "model_path": "$model_path",
      "n_ctx": 2048,
      "n_gpu_layers": 0,
      "temperature": 0.3,
      "max_tokens": 500
    },
    "ollama": {
      "type": "ollama",
      "model": "qwen2.5-coder:7b",
      "base_url": "http://localhost:11434",
      "temperature": 0.3,
      "max_tokens": 500
    }
  },
  "language": "pl",
  "system_prompt_language": "polish"
}
EOF

echo "✅ Configuration saved to: local_llm_config.json"

# Make scripts executable
echo "🔐 Making scripts executable..."
chmod +x mock_polish_llm_test.py
chmod +x local_llm_integration.py

if [ "$DEPS_ONLY" = "false" ]; then
    # Run mock test
    echo "🧪 Running mock test..."
    python3 mock_polish_llm_test.py
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Test mock implementation: python3 mock_polish_llm_test.py"
echo "2. Test full integration: python3 local_llm_integration.py"
echo "3. Configure model type in local_llm_config.json"
echo "4. Run with specific model: python3 local_llm_integration.py --gguf $model_path"
echo ""
echo "💡 For GPU acceleration, set n_gpu_layers: -1 in config"
echo "📖 Documentation: Check the generated scripts for more options"
