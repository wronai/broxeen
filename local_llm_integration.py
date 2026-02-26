#!/usr/bin/env python3
"""
Local LLM Integration for NLP2CMD with Polish Language Support

This script sets up and configures nlp2cmd to work with local LLM models
instead of cloud APIs, with full Polish language support.

Features:
- Local LLM support via llama-cpp-python or Ollama
- Polish language prompts and responses
- Mock client for testing without models
- Integration with nlp2cmd planner and executor
- Multiple domain support (SQL, Shell, Docker, Kubernetes)

Requirements:
- nlp2cmd[all] or individual components
- llama-cpp-python (for GGUF models) OR
- litellm (for Ollama/local API servers)

Author: Generated for Broxeen project
"""

import os
import sys
import json
import asyncio
import logging
from pathlib import Path
from typing import Optional, Dict, Any, Union
from dataclasses import dataclass

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add nlp2cmd to path
nlp2cmd_path = Path("/home/tom/github/wronai/nlp2cmd")
if nlp2cmd_path.exists():
    sys.path.insert(0, str(nlp2cmd_path))
    logger.info(f"Added nlp2cmd to path: {nlp2cmd_path}")
else:
    logger.warning(f"nlp2cmd not found at {nlp2cmd_path}")

# Try imports with graceful fallback
try:
    from nlp2cmd.planner import LLMPlanner, PlannerConfig
    from nlp2cmd.executor import PlanExecutor
    from nlp2cmd.generation.llm_simple import (
        LiteLLMClient, 
        SimpleLLMSQLGenerator,
        SimpleLLMShellGenerator,
        SimpleLLMDockerGenerator,
        SimpleLLMKubernetesGenerator,
        MockLLMClient
    )
    NLP2CMD_AVAILABLE = True
    logger.info("✅ nlp2cmd imports successful")
except ImportError as e:
    logger.error(f"❌ nlp2cmd import failed: {e}")
    NLP2CMD_AVAILABLE = False


@dataclass
class LocalLLMConfig:
    """Configuration for local LLM setup."""
    
    # Model type
    model_type: str = "mock"  # mock, gguf, ollama, openai-compatible
    
    # GGUF model settings
    gguf_model_path: Optional[str] = None
    gguf_n_ctx: int = 2048
    gguf_n_gpu_layers: int = 0  # -1 for all layers on GPU
    
    # Ollama settings
    ollama_model: str = "qwen2.5-coder:7b"
    ollama_base_url: str = "http://localhost:11434"
    
    # OpenAI-compatible settings
    openai_base_url: str = "http://localhost:8080/v1"
    openai_model: str = "local-model"
    openai_api_key: str = "not-needed"
    
    # Generation settings
    temperature: float = 0.3
    max_tokens: int = 500
    timeout: float = 30.0
    
    # Polish language settings
    language: str = "pl"
    system_prompt_language: str = "polish"
    
    @classmethod
    def from_env(cls) -> 'LocalLLMConfig':
        """Create configuration from environment variables."""
        config = cls()
        
        # Check for environment variables
        model_path = os.environ.get('NLP2CMD_LLM_MODEL_PATH')
        lite_llm_model = os.environ.get('LITELLM_MODEL')
        
        if model_path and lite_llm_model == 'local/model':
            # Local GGUF model via environment
            config.model_type = "gguf"
            config.gguf_model_path = model_path
            logger.info(f"Using local GGUF model from env: {model_path}")
        elif lite_llm_model and 'ollama' in lite_llm_model.lower():
            # Ollama model
            config.model_type = "ollama"
            config.ollama_model = lite_llm_model
            logger.info(f"Using Ollama model from env: {lite_llm_model}")
        elif lite_llm_model and 'localhost' in lite_llm_model:
            # Local API server
            config.model_type = "openai-compatible"
            config.openai_base_url = lite_llm_model.replace('local/model', 'http://localhost:8080/v1')
            logger.info(f"Using local API server from env: {lite_llm_model}")
        
        return config


class PolishLLMClient:
    """Polish language LLM client wrapper."""
    
    def __init__(self, config: LocalLLMConfig):
        self.config = config
        self.client = None
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize the appropriate LLM client."""
        
        if self.config.model_type == "mock":
            self.client = MockPolishLLMClient()
            logger.info("🤖 Using Mock Polish LLM Client")
            
        elif self.config.model_type == "gguf":
            self.client = GGUFPolishLLMClient(self.config)
            logger.info("🦙 Using GGUF Polish LLM Client")
            
        elif self.config.model_type == "ollama":
            self.client = OllamaPolishLLMClient(self.config)
            logger.info("🦊 Using Ollama Polish LLM Client")
            
        elif self.config.model_type == "openai-compatible":
            self.client = OpenAIPolishLLMClient(self.config)
            logger.info("🔗 Using OpenAI-Compatible Polish LLM Client")
            
        else:
            raise ValueError(f"Unsupported model type: {self.config.model_type}")
    
    async def complete(self, user: str, system: Optional[str] = None, **kwargs) -> str:
        """Generate completion."""
        return await self.client.complete(user, system, **kwargs)


class MockPolishLLMClient:
    """Mock Polish LLM client for testing."""
    
    def __init__(self):
        self.responses = self._setup_polish_responses()
    
    def _setup_polish_responses(self) -> Dict[str, str]:
        """Setup Polish mock responses."""
        return {
            "otwórz": "playwright_open",
            "wypełnij": "playwright_fill", 
            "kliknij": "playwright_click",
            "wyślij": "playwright_submit",
            "plik": "shell_find",
            "proces": "shell_ps",
            "kontener": "docker_ps",
            "kubectl": "kubectl_get",
            "użytkownik": "sql_select_users",
            "zamówienie": "sql_select_orders",
        }
    
    async def complete(self, user: str, system: Optional[str] = None, **kwargs) -> str:
        """Generate mock completion."""
        user_lower = user.lower()
        
        # Check for specific patterns
        for keyword, response in self.responses.items():
            if keyword in user_lower:
                return self._generate_polish_response(keyword, user)
        
        # Default response
        return json.dumps({
            "steps": [{
                "action": "shell_command",
                "params": {"command": f"echo 'Przetwarzam: {user}'"},
                "store_as": "result"
            }]
        }, ensure_ascii=False)
    
    def _generate_polish_response(self, keyword: str, query: str) -> str:
        """Generate Polish response for keyword."""
        
        if keyword == "otwórz" and "http" in query.lower():
            # Extract URL
            import re
            url_match = re.search(r'https://[^\s]+', query)
            url = url_match.group(0) if url_match else "https://example.com"
            
            return json.dumps({
                "steps": [{
                    "action": "playwright_open",
                    "params": {"url": url},
                    "store_as": "page"
                }]
            }, ensure_ascii=False)
        
        elif keyword == "plik":
            return json.dumps({
                "steps": [{
                    "action": "shell_find",
                    "params": {"pattern": "*.log"},
                    "store_as": "files"
                }]
            }, ensure_ascii=False)
        
        elif keyword == "użytkownik":
            return json.dumps({
                "steps": [{
                    "action": "sql_select",
                    "params": {
                        "table": "users",
                        "columns": "*",
                        "limit": 10
                    },
                    "store_as": "users"
                }]
            }, ensure_ascii=False)
        
        # Default for keyword
        return json.dumps({
            "steps": [{
                "action": f"{keyword}_action",
                "params": {},
                "store_as": "result"
            }]
        }, ensure_ascii=False)


class GGUFPolishLLMClient:
    """GGUF model client for Polish LLM."""
    
    def __init__(self, config: LocalLLMConfig):
        self.config = config
        self.llm = None
        self._load_model()
    
    def _load_model(self):
        """Load GGUF model."""
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError("llama-cpp-python required for GGUF models")
        
        if not self.config.gguf_model_path or not os.path.exists(self.config.gguf_model_path):
            raise FileNotFoundError(f"GGUF model not found: {self.config.gguf_model_path}")
        
        logger.info(f"Loading GGUF model: {self.config.gguf_model_path}")
        self.llm = Llama(
            model_path=self.config.gguf_model_path,
            n_ctx=self.config.gguf_n_ctx,
            n_gpu_layers=self.config.gguf_n_gpu_layers,
            verbose=False
        )
        logger.info("✅ GGUF model loaded successfully")
    
    async def complete(self, user: str, system: Optional[str] = None, **kwargs) -> str:
        """Generate completion with GGUF model."""
        
        system_prompt = system or self._get_polish_system_prompt()
        
        response = self.llm(
            user,
            system_prompt=system_prompt,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            stop=["\n\n", "```"],
            echo=False
        )
        
        return response["choices"][0]["text"].strip()
    
    def _get_polish_system_prompt(self) -> str:
        """Get Polish system prompt."""
        return """Jesteś asystentem generującym plany wykonania dla poleceń w języku polskim.

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

Dostępne akcje:
- playwright_open: Otwórz stronę WWW
- playwright_fill: Wypełnij formularz
- shell_command: Wykonaj komendę shell
- sql_select: Wykonaj zapytanie SQL
- docker_ps: Pokaż kontenery
- kubectl_get: Pobierz zasoby Kubernetes

Odpowiedz TYLKO JSONem."""


class OllamaPolishLLMClient:
    """Ollama client for Polish LLM."""
    
    def __init__(self, config: LocalLLMConfig):
        self.config = config
        self.client = None
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize Ollama client."""
        try:
            from nlp2cmd.generation.llm_simple import LiteLLMClient
            self.client = LiteLLMClient(
                model=self.config.ollama_model,
                api_base=self.config.ollama_base_url
            )
            logger.info(f"✅ Ollama client initialized: {self.config.ollama_model}")
        except ImportError:
            raise ImportError("litellm required for Ollama integration")
    
    async def complete(self, user: str, system: Optional[str] = None, **kwargs) -> str:
        """Generate completion with Ollama."""
        polish_user = f"Użytkownik pyta (w języku polskim): {user}"
        polish_system = system or self._get_polish_system_prompt()
        
        return await self.client.complete(
            user=polish_user,
            system=polish_system,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature
        )
    
    def _get_polish_system_prompt(self) -> str:
        """Get Polish system prompt for Ollama."""
        return """Jesteś polskim asystentem AI. Generuj plany wykonania w formacie JSON.

Dostępne akcje:
- shell_command: komendy bash
- sql_select: zapytania SQL  
- docker_ps: zarządzanie kontenerami
- playwright_open: otwieranie stron

Odpowiedz TYLKO JSONem z pole "steps"."""


class OpenAIPolishLLMClient:
    """OpenAI-compatible client for Polish LLM."""
    
    def __init__(self, config: LocalLLMConfig):
        self.config = config
        self.client = None
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize OpenAI-compatible client."""
        try:
            from nlp2cmd.generation.llm_simple import LiteLLMClient
            self.client = LiteLLMClient(
                model=self.config.openai_model,
                api_base=self.config.openai_base_url,
                api_key=self.config.openai_api_key
            )
            logger.info(f"✅ OpenAI-compatible client initialized: {self.config.openai_model}")
        except ImportError:
            raise ImportError("litellm required for OpenAI-compatible integration")
    
    async def complete(self, user: str, system: Optional[str] = None, **kwargs) -> str:
        """Generate completion with OpenAI-compatible API."""
        polish_user = f"Użytkownik pyta (w języku polskim): {user}"
        polish_system = system or self._get_polish_system_prompt()
        
        return await self.client.complete(
            user=polish_user,
            system=polish_system,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature
        )
    
    def _get_polish_system_prompt(self) -> str:
        """Get Polish system prompt."""
        return """Jesteś polskim asystentem AI. Generuj plany wykonania w języku polskim.

Format: JSON z pole "steps" zawierającym listę kroków.

Dostępne akcje:
- shell_command
- sql_select  
- docker_ps
- playwright_open

Odpowiedz TYLKO JSONem."""


class LocalPolishNLP2CMD:
    """Main integration class for local Polish LLM with nlp2cmd."""
    
    def __init__(self, config: LocalLLMConfig):
        self.config = config
        self.llm_client = PolishLLMClient(config)
        self.planner = None
        self.executor = None
        self._initialize_components()
    
    def _initialize_components(self):
        """Initialize nlp2cmd components."""
        if not NLP2CMD_AVAILABLE:
            logger.warning("nlp2cmd not available, using mock implementation")
            return
        
        # Initialize planner
        planner_config = PlannerConfig(
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            include_examples=True
        )
        
        self.planner = LLMPlanner(
            llm_client=self.llm_client,
            config=planner_config
        )
        
        # Initialize executor
        self.executor = PlanExecutor()
        
        logger.info("✅ nlp2cmd components initialized")
    
    async def process_query(self, query: str, run: bool = False) -> Dict[str, Any]:
        """Process Polish query with local LLM."""
        logger.info(f"📝 Processing query: {query}")
        
        try:
            if self.planner:
                # Use nlp2cmd planner
                result = self.planner.plan(
                    intent="auto",
                    entities={},
                    text=query,
                    context={"language": "polish"}
                )
                
                if result.success and run and self.executor:
                    logger.info("🚀 Executing plan...")
                    exec_result = self.executor.execute(result.plan)
                    return {
                        "query": query,
                        "plan": result.plan,
                        "execution": exec_result,
                        "success": True
                    }
                
                return {
                    "query": query,
                    "plan": result.plan,
                    "success": result.success,
                    "error": result.error
                }
            
            else:
                # Fallback to direct LLM call
                plan_json = await self.llm_client.complete(query)
                try:
                    plan = json.loads(plan_json)
                    return {
                        "query": query,
                        "plan": plan,
                        "success": True,
                        "executed": False
                    }
                except json.JSONDecodeError as e:
                    return {
                        "query": query,
                        "raw_response": plan_json,
                        "success": False,
                        "error": f"JSON parse error: {e}"
                    }
        
        except Exception as e:
            logger.error(f"❌ Error processing query: {e}")
            return {
                "query": query,
                "success": False,
                "error": str(e)
            }


def setup_mock_environment():
    """Setup mock environment for testing."""
    config = LocalLLMConfig(
        model_type="mock",
        language="pl"
    )
    
    logger.info("🔧 Setting up mock Polish LLM environment")
    return config


def setup_gguf_environment(model_path: str):
    """Setup GGUF environment."""
    if not os.path.exists(model_path):
        logger.error(f"❌ GGUF model not found: {model_path}")
        return None
    
    config = LocalLLMConfig(
        model_type="gguf",
        gguf_model_path=model_path,
        gguf_n_ctx=2048,
        gguf_n_gpu_layers=0,  # Set to -1 for GPU acceleration
        temperature=0.3,
        max_tokens=500
    )
    
    logger.info(f"🦙 Setting up GGUF environment: {model_path}")
    return config


def setup_ollama_environment(model: str = "qwen2.5-coder:7b", base_url: str = "http://localhost:11434"):
    """Setup Ollama environment."""
    config = LocalLLMConfig(
        model_type="ollama",
        ollama_model=model,
        ollama_base_url=base_url,
        temperature=0.3,
        max_tokens=500
    )
    
    logger.info(f"🦊 Setting up Ollama environment: {model} at {base_url}")
    return config


async def test_polish_queries(nlp2cmd: LocalPolishNLP2CMD):
    """Test Polish language queries."""
    
    test_queries = [
        "Otwórz https://www.google.pl",
        "Pokaż wszystkie pliki .log w katalogu /var/log",
        "Wyświetl 10 ostatnich zamówień z bazy danych",
        "Znajdź procesy używające najwięcej pamięci",
        "Sprawdź status kontenera docker nginx",
        "Wyczyść cache systemowy",
        "Pokaż użycie dysku dla wszystkich partycji",
        "Uruchom usługę nginx",
        "Znajdź pliki większe niż 100MB",
        "Pokaż wszystkie deploymenty w Kubernetes"
    ]
    
    logger.info(f"🧪 Testing {len(test_queries)} Polish queries")
    
    results = []
    for i, query in enumerate(test_queries, 1):
        logger.info(f"\n{i}. {query}")
        logger.info("-" * 50)
        
        try:
            result = await nlp2cmd.process_query(query, run=False)
            results.append(result)
            
            if result["success"]:
                plan = result.get("plan", {})
                if "steps" in plan:
                    logger.info(f"✅ Generated {len(plan['steps'])} steps")
                    for j, step in enumerate(plan["steps"][:3], 1):
                        logger.info(f"   {j}. {step.get('action', 'unknown')}: {step.get('params', {})}")
                else:
                    logger.info("✅ Generated response")
            else:
                logger.error(f"❌ Failed: {result.get('error', 'Unknown error')}")
        
        except Exception as e:
            logger.error(f"❌ Exception: {e}")
            results.append({
                "query": query,
                "success": False,
                "error": str(e)
            })
    
    # Summary
    successful = sum(1 for r in results if r.get("success", False))
    total = len(results)
    
    logger.info(f"\n📊 Test Summary:")
    logger.info(f"Total queries: {total}")
    logger.info(f"Successful: {successful}")
    logger.info(f"Failed: {total - successful}")
    logger.info(f"Success rate: {successful/total*100:.1f}%")
    
    return results


async def main():
    """Main function demonstrating local LLM integration."""
    
    print("🤖 Local Polish LLM Integration for NLP2CMD")
    print("=" * 60)
    
    # Check nlp2cmd availability
    if not NLP2CMD_AVAILABLE:
        logger.warning("nlp2cmd not available, some features will be limited")
    
    # Load configuration from environment variables first
    env_config = LocalLLMConfig.from_env()
    print(f"🔧 Environment config: {env_config.model_type}")
    
    # Setup configurations
    configs = []
    
    # 1. Environment configuration (priority)
    if env_config.model_type != "mock":
        configs.append(("Environment", env_config))
    
    # 2. Mock environment (always available)
    mock_config = setup_mock_environment()
    configs.append(("Mock", mock_config))
    
    # 2. GGUF environment (if model available)
    gguf_paths = [
        "polka-1.1b-chat.gguf",
        "models/polka-1.1b-chat.gguf",
        "/home/tom/.cache/huggingface/hub/models--*polka*/gguf/polka-1.1b-chat.gguf"
    ]
    
    gguf_config = None
    for path in gguf_paths:
        if "*" in path:
            import glob
            matches = glob.glob(path)
            if matches:
                gguf_config = setup_gguf_environment(matches[0])
                break
        elif os.path.exists(path):
            gguf_config = setup_gguf_environment(path)
            break
    
    if gguf_config:
        configs.append(("GGUF", gguf_config))
    
    # 3. Ollama environment (if server running)
    try:
        import requests
        response = requests.get("http://localhost:11434/api/tags", timeout=5)
        if response.status_code == 200:
            ollama_config = setup_ollama_environment()
            configs.append(("Ollama", ollama_config))
    except:
        logger.info("Ollama server not available")
    
    # Test each configuration
    for name, config in configs:
        print(f"\n🧪 Testing {name} Configuration")
        print("-" * 40)
        
        try:
            nlp2cmd = LocalPolishNLP2CMD(config)
            results = await test_polish_queries(nlp2cmd)
            
            print(f"✅ {name} test completed")
            
        except Exception as e:
            print(f"❌ {name} test failed: {e}")
    
    print(f"\n🎉 Local LLM Integration Test Complete!")
    print("\n💡 Environment Variable Usage:")
    print("export LITELLM_MODEL=\"local/model\"")
    print("export NLP2CMD_LLM_MODEL_PATH=\"polka-1.1b-chat.gguf\"")
    print("\n💡 Next Steps:")
    print("1. Install required packages: pip install llama-cpp-python nlp2cmd[all]")
    print("2. Download Polish model: wget https://huggingface.co/TinyLlama/Polka-1.1B-Chat-GGUF/resolve/main/polka-1.1b-chat.gguf")
    print("3. Set environment: make nlp2cmd-set-local MODEL_PATH=models/polka-1.1b-chat.gguf")
    print("4. Run with: source .nlp2cmd-env && make dev")


if __name__ == "__main__":
    asyncio.run(main())
