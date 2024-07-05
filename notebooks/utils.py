import base64
import json


def get_base64_encoded_image(image_path):
    with open(image_path, "rb") as image_file:
        binary_data = image_file.read()
        base_64_encoded_data = base64.b64encode(binary_data)
        base64_string = base_64_encoded_data.decode('utf-8')
        return base64_string


def build_message_list(image_path, user_prompt):
    message_list = [
        {
            "role": 'user',
            "content": [
                {
                    "type": "image", "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": get_base64_encoded_image(image_path)
                    }
                }, {
                    "type": "text",
                    "text": user_prompt
                }
            ]
        }]
    return message_list


def build_few_shot_message_list(image_path, example_image, example_canvas):
    example_response = f'''<canvas>
{example_canvas}
</canvas>'''
    message_list = [
        {
            "role": 'user',
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": get_base64_encoded_image(example_image)
                    }
                }, {
                    "type": "text",
                    "text": "Turn this sketch into a JSON canvas."
                }
            ]
        }, {
            "role": 'assistant',
            "content": [
                {
                    "type": "text",
                    "text": example_response
                }
            ]
        }, {
            "role": 'user',
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": get_base64_encoded_image(image_path)
                    }
                }, {
                    "type": "text",
                    "text": "Turn this sketch into a JSON canvas."
                }
            ]
        }]
    return message_list


def parse_json_response(response):
    if len(response.content) == 1:
        json_text = response.content[0].text
        if json_text.rfind('```json') >= 0:
            json_text = json_text[json_text.rfind('```json')+7:]
            json_text = json_text[:json_text.rfind('```')]
        return json.loads(json_text)
    return None


def parse_xml_response(response):
    if len(response.content) == 1:
        json_text = response.content[0].text
        if json_text.rfind('<canvas>') >= 0:
            json_text = json_text[json_text.rfind('<canvas>')+8:]
            json_text = json_text[:json_text.rfind('</canvas>')]
        return json.loads(json_text)
    return None
