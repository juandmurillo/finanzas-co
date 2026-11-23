"""Arranque de escritorio: carpeta de datos, configuración empaquetada e instancia única (sin abrir ventana)."""

import json
import os
from pathlib import Path

import pytest

from finanzas import escritorio


def test_datos_fuera_de_la_instalacion(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("CAUDAL_DATOS", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert escritorio.carpeta_datos() == tmp_path / "Caudal" / "datos"
    monkeypatch.setenv("CAUDAL_DATOS", str(tmp_path / "otra"))
    assert escritorio.carpeta_datos() == tmp_path / "otra"


def test_sync_empaquetado_configura_el_receptor(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for variable in ("FINANZAS_SYNC_RECEPTOR", "FINANZAS_SYNC_APIKEY"):
        monkeypatch.delenv(variable, raising=False)
    destino = {"receptor": "supabase+https://proyecto.supabase.co", "apikey": "sb_publishable_x"}
    (tmp_path / "sync.json").write_text(json.dumps(destino), encoding="utf-8")
    escritorio.configurar(tmp_path)
    assert os.environ["FINANZAS_SYNC_RECEPTOR"] == destino["receptor"]
    assert os.environ["FINANZAS_SYNC_APIKEY"] == destino["apikey"]


def test_una_sola_instancia_por_base(tmp_path: Path) -> None:
    # Con la primera abierta, la segunda falla.
    with (
        escritorio.instancia_unica(tmp_path),
        pytest.raises(escritorio.YaAbierto),
        escritorio.instancia_unica(tmp_path),
    ):
        pass
    # Al cerrar, el candado se libera.
    with escritorio.instancia_unica(tmp_path):
        pass


def test_en_desarrollo_usa_la_interfaz_del_repositorio() -> None:
    raiz = escritorio.recursos()
    assert (raiz / "backend").is_dir() and (raiz / "frontend").is_dir()
