using TaskbarHero.UI;
using UnityEngine;

namespace TbhAutoSynth;

internal static class CorrosionRecipeSelector
{
	internal static MainRecipeSlotButton Find(UI_Cube cube, ComboBoxButton combo, string operation = "corrosion")
	{
		MainRecipeSlotButton[]? array = Object.FindObjectsOfType<MainRecipeSlotButton>(includeInactive: true);
		MainRecipeSlotButton mainRecipeSlotButton = null;
		MainRecipeSlotButton result = null;
		int num = 0;
		GameObject comboBoxObject = combo.m_comboBoxObject;
		Transform transform = ((comboBoxObject != null) ? comboBoxObject.transform : null);
		Transform transform2 = cube.transform;
		MainRecipeSlotButton[] array2 = array;
		foreach (MainRecipeSlotButton mainRecipeSlotButton2 in array2)
		{
			string text = ((mainRecipeSlotButton2 != null && mainRecipeSlotButton2.m_text != null) ? (mainRecipeSlotButton2.m_text.text ?? "") : "");
			bool flag = ((operation == "synthesis") ? text.Contains("合成") : text.Contains("腐蚀"));
			if (mainRecipeSlotButton2 == null || mainRecipeSlotButton2.m_text == null || !flag)
			{
				continue;
			}
			num++;
			result = mainRecipeSlotButton2;
			MainRecipeComboBoxButton bhqw = mainRecipeSlotButton2.bhqw;
			bool num2 = bhqw != null && bhqw.Pointer == combo.Pointer;
			Transform transform3 = mainRecipeSlotButton2.transform;
			bool flag2 = transform != null && (transform3 == transform || transform3.IsChildOf(transform));
			bool flag3 = transform3 == transform2 || transform3.IsChildOf(transform2);
			if (num2 | flag2 | flag3)
			{
				if (mainRecipeSlotButton != null)
				{
					return null;
				}
				mainRecipeSlotButton = mainRecipeSlotButton2;
			}
		}
		if (mainRecipeSlotButton != null)
		{
			return mainRecipeSlotButton;
		}
		if (num != 1)
		{
			return null;
		}
		return result;
	}
}
