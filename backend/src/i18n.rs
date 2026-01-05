// Internationalization module for backend error messages and responses

use std::collections::HashMap;

#[allow(dead_code)]
pub struct I18n {
    messages: HashMap<String, HashMap<String, String>>,
}

#[allow(dead_code)]
impl I18n {
    pub fn new() -> Self {
        let mut messages = HashMap::new();

        // English messages
        let mut en = HashMap::new();
        en.insert(
            "product_created".to_string(),
            "Product submitted successfully, pending review".to_string(),
        );
        en.insert(
            "product_updated".to_string(),
            "Product updated successfully".to_string(),
        );
        en.insert(
            "product_deleted".to_string(),
            "Product deleted successfully".to_string(),
        );
        en.insert(
            "product_not_found".to_string(),
            "Product not found".to_string(),
        );
        en.insert(
            "validation_error".to_string(),
            "Please check your input".to_string(),
        );
        en.insert(
            "server_error".to_string(),
            "An error occurred on the server".to_string(),
        );
        messages.insert("en".to_string(), en);

        // Chinese messages
        let mut zh = HashMap::new();
        zh.insert(
            "product_created".to_string(),
            "产品提交成功，等待审核".to_string(),
        );
        zh.insert("product_updated".to_string(), "产品更新成功".to_string());
        zh.insert("product_deleted".to_string(), "产品删除成功".to_string());
        zh.insert("product_not_found".to_string(), "未找到产品".to_string());
        zh.insert("validation_error".to_string(), "请检查你的输入".to_string());
        zh.insert("server_error".to_string(), "服务器发生错误".to_string());
        messages.insert("zh".to_string(), zh);

        Self { messages }
    }

    pub fn get(&self, lang: &str, key: &str) -> String {
        let lang = if lang.starts_with("zh") { "zh" } else { "en" };

        self.messages
            .get(lang)
            .and_then(|msgs| msgs.get(key))
            .cloned()
            .unwrap_or_else(|| {
                self.messages
                    .get("en")
                    .and_then(|msgs| msgs.get(key))
                    .cloned()
                    .unwrap_or_else(|| key.to_string())
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_i18n_english() {
        let i18n = I18n::new();
        assert_eq!(
            i18n.get("en", "product_created"),
            "Product submitted successfully, pending review"
        );
    }

    #[test]
    fn test_i18n_chinese() {
        let i18n = I18n::new();
        assert_eq!(i18n.get("zh", "product_created"), "产品提交成功，等待审核");
    }
}
